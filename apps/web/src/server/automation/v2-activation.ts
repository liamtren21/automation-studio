import {randomUUID} from 'node:crypto';
import {getAddress,type Address,type Hex} from 'viem';
import type {Database} from '../../../../../packages/db/src/database';
import {getV2Account} from './v2-account';
import {listBatchDrafts} from './batch-drafts';
import {currentProtection} from './protection';
import {executorConfiguration} from './runtime-health';
import {batchConfiguration,batchConfigurationHash,preflightV2BatchAccount} from '../../../../../packages/mezo/src/automation-v2-batch';
import {groupSetupTransaction,type GroupReview,type GroupSetupStep} from '../../../../../packages/mezo/src/automation-v2-setup';
import {automationV2Artifact} from '../../../../../packages/mezo/src/automation-v2-artifact';
import {publicClient} from '../../../../../packages/mezo/src/network';
import type {BatchDraft} from '../../../../../packages/automation/src/studio/batch';
export interface BatchPolicyBody {draft:BatchDraft;owner:Address;account:Address;globalBudget:string}
export interface BatchPolicyRow {workspace_id:string;draft_id:string;account:string;policy_id:Hex;version:string;config_hash:Hex;body:BatchPolicyBody;status:'setup'|'active'|'stopped'}
export const setupLabels:Record<GroupSetupStep,string>={classify:'Prepare payment budget',protection:'Protect your cash reserve',configure:'Approve this group payment',allocate:'Set money aside for this group',executor:'Enable automatic group payments',revoke:'Stop group payments'};
export async function loadBatchState(db:Database,workspace:string,draftId:string){
 const binding=await getV2Account(db,workspace),saved=(await listBatchDrafts(db,workspace)).find(r=>r.id===draftId);
 if(!binding||!saved||workspace!=='live:'+binding.owner.toLowerCase())throw Error('Group payment account or draft not found.');
 if(BigInt(saved.draft.lifetimeBudget)>BigInt(binding.globalBudget))throw Error('The group budget is larger than the account spending limit.');
 const config=batchConfiguration(workspace,draftId,binding.address,saved.draft),p=publicClient(),preflight=await preflightV2BatchAccount(p,{account:binding.address,owner:binding.owner,globalBudget:BigInt(binding.globalBudget)}),blockNumber=BigInt(preflight.snapshot.blockNumber);
 const read=<N extends 'policyOf'|'payeesOf'|'allocation'|'lifetimeSpent'|'capitalFree'|'unclassified'|'committed'|'buffer'|'protectionExpiry'|'paused'|'globalSpent'>(functionName:N,args?:readonly unknown[])=>p.readContract({address:binding.address,abi:automationV2Artifact.abi,functionName,args,blockNumber} as never) as Promise<unknown>;
 const [actualRaw,payeesRaw,allocated,spent,capital,unclassified,committed,buffer,expiry,paused,globalSpent,source]=await Promise.all([read('policyOf',[config.id]),read('payeesOf',[config.id]),read('allocation',[config.id]),read('lifetimeSpent',[config.id]),read('capitalFree'),read('unclassified'),read('committed'),read('buffer'),read('protectionExpiry'),read('paused'),read('globalSpent'),currentProtection(db,workspace)]);
 const actual=actualRaw as typeof config.policy,[payees,values]=payeesRaw as [Address[],bigint[]],allocation=allocated as bigint,lifetimeSpent=spent as bigint,capitalFree=capital as bigint,unclassifiedFunds=unclassified as bigint,now=BigInt(preflight.snapshot.blockTimestamp);
 const executor=executorConfiguration(process.env.STUDIO_EXECUTOR_ADDRESS,process.env.STUDIO_EXECUTOR_PRIVATE_KEY).address as Address|null;
 const executorAllowed=executor?await p.readContract({address:binding.address,abi:automationV2Artifact.abi,functionName:'executors',args:[executor],blockNumber}):false;
 const configured=actual.version>0n,stopped=configured&&!actual.enabled;
 if(configured&&!stopped&&batchConfigurationHash(binding.address,actual,payees,values).toLowerCase()!==config.hash.toLowerCase())throw Error('The group approval changed. Use a new draft before sending payments.');
 const record=(await db.query<BatchPolicyRow>('SELECT workspace_id,draft_id,account,policy_id,version::text,config_hash,body,status FROM studio_batch_policies WHERE workspace_id=$1 AND draft_id=$2',[workspace,draftId])).rows[0];
 if(record&&record.config_hash.toLowerCase()!==config.hash.toLowerCase())throw Error('The saved group approval no longer matches this draft.');
 const stored=(binding.body as typeof binding.body&{protection?:{sourceHash:string;committed:string;buffer:string;expiresAt:string;blockNumber:string;blockHash:string}}).protection;
 let protectedCash=!!stored&&stored.sourceHash.toLowerCase()===source.sourceHash.toLowerCase()&&stored.committed===String(committed)&&stored.buffer===String(buffer)&&stored.expiresAt===String(expiry)&&BigInt(String(expiry))>now&&String(committed)===source.committedBills&&String(buffer)===source.buffer;
 if(protectedCash&&stored)protectedCash=(await p.getBlock({blockNumber:BigInt(stored.blockNumber)})).hash===stored.blockHash;
 const total=BigInt(saved.draft.totalPerBatch),expired=now>=config.policy.endAt,completed=lifetimeSpent+total>config.policy.lifetimeCap;
 const period=now<config.policy.startAt||expired?null:((now-config.policy.startAt)/config.policy.interval).toString();
 const consumed=period!==null?await p.readContract({address:binding.address,abi:automationV2Artifact.abi,functionName:'periodConsumed',args:[config.id,BigInt(period)],blockNumber}):false;
 let step:GroupSetupStep|null=null,blocked:string|null=null;
 if(!stopped&&!completed&&!expired){
  if(paused)blocked='Group payments are paused for this account.';
  else if(!executor)blocked='The payment service has not been configured.';
  else if(allocation<total&&capitalFree<total-allocation){if(unclassifiedFunds>=total-allocation-capitalFree)step='classify';else blocked='Add funds to cover this group payment.';}
  if(!blocked&&!step){if(!protectedCash)step='protection';else if(!configured)step='configure';else if(allocation<total)step='allocate';else if(!executorAllowed)step='executor';}
 }
 if((await p.getBlock({blockNumber})).hash!==preflight.snapshot.blockHash)throw Error('The group payment snapshot changed. Try again.');
 return {binding,saved,config,record,preflight,actual,allocation,lifetimeSpent,capitalFree,unclassifiedFunds,committed:String(committed),buffer:String(buffer),expiry:String(expiry),source,executor,executorAllowed,step,blocked,stopped,completed,expired,period,consumed,paused:!!paused,globalSpent:globalSpent as bigint,protectedCash};
}
export async function publicBatchStatus(db:Database,workspace:string,draftId:string){
 const s=await loadBatchState(db,workspace,draftId);
 const runs=(await db.query<{id:string;state:string;body:{signed?:{hash?:string};reason?:string;receiptBlock?:string;receiptBlockHash?:string};period_index:string}>('SELECT id,state,body,period_index::text FROM studio_batch_runs WHERE workspace_id=$1 AND draft_id=$2 ORDER BY created_at DESC LIMIT 20',[workspace,draftId])).rows;
 return {draftId,account:s.binding.address,owner:s.binding.owner,globalBudget:s.binding.globalBudget,step:s.step,label:s.step?setupLabels[s.step]:null,approved:s.actual.version>0n,blocked:s.blocked,stopped:s.stopped,completed:s.completed,expired:s.expired,active:s.record?.status==='active'&&!s.stopped&&!s.expired,ready:!s.step&&!s.blocked&&!s.stopped&&!s.completed&&!s.expired,serviceEnabled:process.env.STUDIO_V2_BATCH_EXECUTION==='true'&&process.env.STUDIO_AUTOMATION_EXECUTION==='true',source:{committed:s.source.committedBills,buffer:s.source.buffer,hash:s.source.sourceHash},executor:s.executor,allocation:s.allocation.toString(),spent:s.lifetimeSpent.toString(),runs:runs.map(r=>({id:r.id,state:r.state,period:r.period_index,txHash:r.body.signed?.hash,reason:r.body.reason,block:r.body.receiptBlock}))};
}
async function ensureBatchPolicy(db:Database,workspace:string,s:Awaited<ReturnType<typeof loadBatchState>>){
 const body:BatchPolicyBody={draft:s.saved.draft,owner:s.binding.owner,account:s.binding.address,globalBudget:s.binding.globalBudget};
 await db.query('INSERT INTO studio_batch_policies(workspace_id,draft_id,account,policy_id,version,config_hash,body) VALUES($1,$2,$3,$4,1,$5,$6::jsonb) ON CONFLICT(workspace_id,draft_id) DO NOTHING',[workspace,s.saved.id,s.binding.address.toLowerCase(),s.config.id,s.config.hash,JSON.stringify(body)]);
}
export async function prepareBatchStep(db:Database,workspace:string,owner:Address,draftId:string,stop=false){
 if(workspace!=='live:'+owner.toLowerCase()||process.env.STUDIO_V2_BATCH_DEPLOYMENT!=='true')throw Error('Use the owner wallet for group payment setup.');
 const s=await loadBatchState(db,workspace,draftId);if(s.binding.owner.toLowerCase()!==owner.toLowerCase())throw Error('Group payment owner changed.');
 const step=stop?'revoke':s.step;
 if(!step)throw Error(s.blocked||'No wallet approval is needed for this group.');
 if(stop&&s.actual.version===0n)throw Error('This group has not been approved yet.');
 await ensureBatchPolicy(db,workspace,s);
 const review:GroupReview={step,draftId,owner:getAddress(owner),account:s.binding.address,globalBudget:s.binding.globalBudget};
 if(step==='classify')review.amount=(BigInt(s.saved.draft.totalPerBatch)-s.allocation-s.capitalFree).toString();
 if(step==='allocate')review.amount=(BigInt(s.saved.draft.totalPerBatch)-s.allocation).toString();
 if(step==='executor')review.executor=s.executor!;
 if(step==='protection'){const end=s.config.policy.endAt,max=BigInt(s.preflight.snapshot.blockTimestamp)+86400n;review.protection={committed:s.source.committedBills,buffer:s.source.buffer,evidence:s.source.sourceHash,expiresAt:(end<max?end:max).toString()};}
 const tx=groupSetupTransaction(review,s.saved.draft),p=publicClient(),blockNumber=BigInt(s.preflight.snapshot.blockNumber);
 await p.call({account:owner,to:s.binding.address,data:tx.data,value:0n,blockNumber});
 if((await p.getBlock({blockNumber})).hash!==s.preflight.snapshot.blockHash)throw Error('This setup review changed. Try again.');
 const id=randomUUID(),transaction={to:tx.to,data:tx.data,value:'0x0',chainId:31611},body={review,transaction};
 await db.query('INSERT INTO studio_batch_reviews(id,workspace_id,draft_id,body) VALUES($1,$2,$3,$4::jsonb)',[id,workspace,draftId,JSON.stringify(body)]);
 return {id,...body,expiresAt:Date.now()+30000};
}
export async function confirmBatchStep(db:Database,workspace:string,owner:Address,reviewId:string,hash:Hex){
 if(workspace!=='live:'+owner.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid group confirmation owner or transaction.');
 const stored=(await db.query<{draft_id:string;tx_hash:string|null;body:{review:GroupReview;transaction:{to:Address;data:Hex}}}>('SELECT draft_id,tx_hash,body FROM studio_batch_reviews WHERE workspace_id=$1 AND id=$2',[workspace,reviewId])).rows[0];
 if(!stored||stored.tx_hash&&stored.tx_hash.toLowerCase()!==hash.toLowerCase())throw Error('Group review not found or already linked to another transaction.');
 const p=publicClient();if(await p.getChainId()!==31611)throw Error('Wrong confirmation chain.');
 const [tx,receipt,head]=await Promise.all([p.getTransaction({hash}),p.getTransactionReceipt({hash}),p.getBlockNumber()]);
 if(tx.from.toLowerCase()!==owner.toLowerCase()||tx.to?.toLowerCase()!==stored.body.transaction.to.toLowerCase()||tx.input.toLowerCase()!==stored.body.transaction.data.toLowerCase()||tx.value!==0n)throw Error('Transaction does not match the reviewed group action.');
 if(receipt.status!=='success')throw Error('Transaction reverted. Check the group payment setup.');
 const block=await p.getBlock({blockNumber:receipt.blockNumber});if(block.hash!==receipt.blockHash||head<receipt.blockNumber+1n)throw Error('Group confirmation is pending.');
 await db.transaction(async q=>{
  const linked=await q.query('UPDATE studio_batch_reviews SET tx_hash=$3 WHERE workspace_id=$1 AND id=$2 AND (tx_hash IS NULL OR tx_hash=$3) RETURNING id',[workspace,reviewId,hash]);if(!linked.rows.length)throw Error('This group review has another transaction.');
  const r=stored.body.review;
  if(r.step==='protection'){const source=await currentProtection(q as Database,workspace);if(r.protection?.evidence.toLowerCase()!==source.sourceHash.toLowerCase())throw Error('Your bills or cash reserve changed. Review cash protection again.');const protection={sourceHash:r.protection.evidence,committed:r.protection.committed,buffer:r.protection.buffer,expiresAt:r.protection.expiresAt,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,txHash:hash};await q.query("UPDATE studio_v2_accounts SET body=jsonb_set(body,'{protection}',$2::jsonb) WHERE workspace_id=$1",[workspace,JSON.stringify(protection)]);}
  if(r.step==='revoke')await q.query("UPDATE studio_batch_policies SET status='stopped' WHERE workspace_id=$1 AND draft_id=$2",[workspace,stored.draft_id]);
 });
 const state=await loadBatchState(db,workspace,stored.draft_id);
 if(!state.step&&!state.blocked&&!state.stopped&&!state.expired&&!state.completed)await db.query("UPDATE studio_batch_policies SET status='active' WHERE workspace_id=$1 AND draft_id=$2 AND status='setup'",[workspace,stored.draft_id]);
 return {confirmed:true,step:stored.body.review.step,status:await publicBatchStatus(db,workspace,stored.draft_id)};
}
export async function finishBatchSetup(db:Database,workspace:string,owner:Address,draftId:string){
 if(workspace!=='live:'+owner.toLowerCase())throw Error('Use the owner wallet to finish group setup.');
 const s=await loadBatchState(db,workspace,draftId);if(s.step||s.blocked||s.stopped||s.expired||s.completed)throw Error('Finish the remaining group approvals first.');
 await ensureBatchPolicy(db,workspace,s);await db.query("UPDATE studio_batch_policies SET status='active' WHERE workspace_id=$1 AND draft_id=$2 AND status='setup'",[workspace,draftId]);
 return publicBatchStatus(db,workspace,draftId);
}
