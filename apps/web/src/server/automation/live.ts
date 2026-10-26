import {reserveHandoffWithdrawal,assertNoPendingRepaymentWithdrawal} from './repayment';
import {getAddress,type Address,type Hex} from 'viem';
import type {Database} from '../../../../../packages/db/src/database';
import {listAutomationPolicies} from '../../../../../packages/db/src/automation';
import {hashPolicy,decideStudio,forecastStudio,type StudioPolicy} from '../../../../../packages/automation/src/studio';
import {publicClient,officialTestnetMusd} from '../../../../../packages/mezo/src/network';
import {readAutomationVault,readAutomationPolicy} from '../../../../../packages/mezo/src/automation-chain';
import {automationOperationData,automationDeploymentData,type StudioOperationInput} from '../../../../../packages/mezo/src/automation-payload';
import {currentProtection,assertCurrentCashProtection} from './protection';
export {currentProtection} from './protection';
import {loadStudioAccount,saveStudioAccount,latestRules,policyHistory,type StudioAccount} from './service';
import {formatMusd as show} from '../../../../../packages/domain/src/money';
import {readRuntimeHealth,executorConfiguration} from './runtime-health';
export async function verifyStudioConfirmation(owner:Address,hash:Hex,expected:{to?:string;data?:string}) {
 const p=publicClient();if(await p.getChainId()!==31611)throw new Error('Wrong confirmation chain.');
 const [receipt,tx,head]=await Promise.all([p.getTransactionReceipt({hash}),p.getTransaction({hash}),p.getBlockNumber()]);
 if(tx.from.toLowerCase()!==owner.toLowerCase())throw new Error('Transaction was not sent by this owner.');
 if(!expected?.to||!expected.data||tx.to?.toLowerCase()!==expected.to.toLowerCase()||tx.input.toLowerCase()!==expected.data.toLowerCase()||tx.value!==0n)throw new Error('Transaction does not match this reviewed action.');
 if(receipt.status!=='success')throw new Error('Transaction reverted. Review the current account state.');
 const block=await p.getBlock({blockNumber:receipt.blockNumber});
 if(head<receipt.blockNumber+1n||block.hash!==receipt.blockHash)throw new Error('Transaction confirmation is pending. Check again shortly.');
 return {tx,receipt,block};
}

function chainPolicy(actual:Awaited<ReturnType<typeof readAutomationPolicy>>['actual']):StudioPolicy {
 return {...actual,chainId:actual.chainId.toString(),version:actual.version.toString(),amount:actual.amount.toString(),startAt:actual.startAt.toString(),endAt:actual.endAt.toString(),intervalSeconds:actual.intervalSeconds.toString(),perRunCap:actual.perRunCap.toString(),perPeriodCap:actual.perPeriodCap.toString(),lifetimeCap:actual.lifetimeCap.toString(),priority:actual.priority.toString()};
}
export async function loadLiveStudioView(db:Database,workspaceId:string,owner:Address) {
 const binding=await loadStudioAccount(db,workspaceId),source=await currentProtection(db,workspaceId);
 if(!binding)return {mode:'live',owner,configured:false,account:null,rules:[],activity:[],source,notice:'Deploy a separate automation vault before granting execution rights.'};
 const vault=await readAutomationVault(binding.vault,owner),records=latestRules(await listAutomationPolicies(db,workspaceId));
 const runtimeHealth=await readRuntimeHealth(binding.vault,vault.block.number,publicClient(),{...executorConfiguration(process.env.STUDIO_EXECUTOR_ADDRESS,process.env.STUDIO_EXECUTOR_PRIVATE_KEY),enabled:process.env.STUDIO_AUTOMATION_EXECUTION==='true'});
 const account:StudioAccount={...binding,balance:vault.balance,globalBudget:vault.globalBudget,globalSpent:vault.globalSpent,committedBills:vault.committedBills,buffer:vault.buffer,protectionSourceHash:vault.sourceHash,protectionExpiresAt:vault.expires,now:vault.block.timestamp.toString(),allocations:{},spent:{},consumed:{}};
 const history=await policyHistory(db,workspaceId);
 const rules=[];
 for(const r of records.filter(r=>r.policy.vault.toLowerCase()===binding.vault.toLowerCase())){
  const c=await readAutomationPolicy(r.policy,owner,source.sourceHash,undefined,vault.block.number),configured=c.actual.version>0n;
  const matches=configured&&hashPolicy(chainPolicy(c.actual))===r.configHash;
  const status=!configured?'draft':!c.actual.enabled?'revoked':!matches?'configuration_changed':vault.paused?'paused':'active';
  const p={...r.policy,enabled:status==='active'};
  await db.query('UPDATE automation_policies SET status=$4 WHERE workspace_id=$1 AND policy_id=$2 AND version=$3',[workspaceId,r.policy.policyId,r.policy.version,status]);
  account.allocations[r.policy.policyId]=c.snapshot.allocation;account.spent[r.policy.policyId]=c.snapshot.lifetimeSpent;account.consumed[r.policy.policyId]=c.snapshot.consumedPeriods;
  const times=Array.from({length:7},(_,i)=>(BigInt(c.snapshot.now)+BigInt(i)*BigInt(p.intervalSeconds)).toString());
  const revisions=history.filter(h=>h.policy.policyId.toLowerCase()===p.policyId.toLowerCase()&&h.policy.vault.toLowerCase()===p.vault.toLowerCase());
  rules.push({...r,status,name:revisions.find(h=>h.version===p.version)?.name??'Scheduled payment',revisions,onchainVersion:c.actual.version.toString(),decision:decideStudio(c.snapshot,p),snapshot:c.snapshot,forecast:forecastStudio(c.snapshot,p,times)});
 }
 const runs=(await db.query<{id:string;policy_id:string;version:string;state:string;body:{requiredAmount?:string;reason?:string;txHash?:string};created_at:string}>('SELECT id,policy_id,version::text,state,body,created_at FROM automation_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[workspaceId])).rows;
 const activity=runs.map(r=>({id:r.id,policyId:r.policy_id,name:history.find(h=>h.policy.policyId===r.policy_id&&h.version===r.version)?.name??'Scheduled payment',at:String(Math.floor(new Date(r.created_at).getTime()/1000)),state:r.state,reason:r.body.reason??r.state,amount:r.body.requiredAmount??'0',...(r.body.txHash?{txHash:r.body.txHash}:{})}));
 const notifications=(await db.query<{id:string;body:{message:string;path:string}}>('SELECT id,body FROM automation_notifications WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20',[workspaceId])).rows.map(n=>({id:n.id,...n.body}));
 return {mode:'live',owner,configured:true,account,rules,activity,source,notifications,runtimeHealth,paused:vault.paused,blockNumber:vault.block.number.toString(),notice:'Mezo Testnet. Only owner-approved rules and funds in this automation vault can be used. Unconfirmed transactions are not completed payments.'};
}
export async function prepareStudioOperation(db:Database,workspaceId:string,owner:Address,input:{operation:string;policyId?:string;amount?:string;executor?:string;allowed?:boolean;repaymentHandoffId?:string}) {
 const a=await loadStudioAccount(db,workspaceId);if(!a||a.mode!=='live'||a.owner.toLowerCase()!==owner.toLowerCase())throw new Error('Set up your own automation vault first.');
 const state=await readAutomationVault(a.vault,owner),review:StudioOperationInput={operation:input.operation as StudioOperationInput['operation'],vault:a.vault,owner};
 if(input.policyId){const rows=latestRules(await listAutomationPolicies(db,workspaceId));const row=rows.find(r=>r.policy.policyId.toLowerCase()===input.policyId!.toLowerCase()&&r.policy.vault.toLowerCase()===a.vault.toLowerCase());if(!row)throw new Error('Rule not found in this workspace.');review.policyId=row.policy.policyId;if(input.operation==='configure')review.policy=row.policy;}
 if(input.amount!==undefined)review.amount=input.amount;
 if(input.operation==='executor'){review.executor=getAddress(input.executor??'');review.allowed=input.allowed;if(review.executor.toLowerCase()===owner.toLowerCase())throw new Error('Use a dedicated executor address, separate from the owner.');}
 if(input.operation==='protection'){const source=await currentProtection(db,workspaceId);review.committedBills=source.committedBills;review.buffer=source.buffer;review.sourceHash=source.sourceHash;review.expiresAt=(state.block.timestamp+86400n).toString();}
 let pinnedNonce:string|undefined;
 if(input.operation==='withdraw'||input.operation==='allocate')assertCurrentCashProtection(state,(await currentProtection(db,workspaceId)).sourceHash);
 if(input.operation==='withdraw'){if(input.repaymentHandoffId)pinnedNonce=await reserveHandoffWithdrawal(db,workspaceId,owner,input.repaymentHandoffId,input.amount??'');else await assertNoPendingRepaymentWithdrawal(db,workspaceId);}
 const transaction={...automationOperationData(review),...(pinnedNonce?{nonce:pinnedNonce}:{})};
 const p=publicClient();await p.call({account:owner,to:transaction.to,data:transaction.data,value:0n,blockNumber:state.block.number});
 return {transaction,review,expiresAt:Date.now()+60000};
}
export async function bindStudioDeployment(db:Database,workspaceId:string,owner:Address,txHash:Hex) {
 const p=publicClient();if(await p.getChainId()!==31611)throw new Error('Wrong deployment chain.');
 const receipt=await p.getTransactionReceipt({hash:txHash});
 if(receipt.status!=='success'||!receipt.contractAddress)throw new Error('Deployment receipt is not a successful contract creation.');
 const block=await p.getBlock({blockNumber:receipt.blockNumber}),head=await p.getBlockNumber();
 if(block.hash!==receipt.blockHash||head<receipt.blockNumber+1n)throw new Error('Deployment confirmation is pending. Check this receipt again.');
 const tx=await p.getTransaction({hash:txHash}),vault=await readAutomationVault(receipt.contractAddress,owner);
 if(tx.from.toLowerCase()!==owner.toLowerCase()||tx.to!==null||tx.value!==0n||tx.input.toLowerCase()!==automationDeploymentData(owner,show(BigInt(vault.globalBudget))).toLowerCase())throw new Error('Deployment does not match the approved automation vault.');
 const existing=await loadStudioAccount(db,workspaceId);if(existing&&existing.vault.toLowerCase()!==vault.vault.toLowerCase())throw new Error('This workspace already has another automation vault.');
 const a:StudioAccount={mode:'live',vault:vault.vault,owner,token:officialTestnetMusd,globalBudget:vault.globalBudget,balance:vault.balance,committedBills:vault.committedBills,buffer:vault.buffer,globalSpent:vault.globalSpent,protectionSourceHash:vault.sourceHash,protectionExpiresAt:vault.expires,now:vault.block.timestamp.toString(),allocations:{},spent:{},consumed:{},labels:{},activity:[],deploymentTx:txHash};
 await db.query('INSERT INTO automation_accounts(workspace_id,mode,chain_id,vault,body) VALUES($1,\'live\',31611,$2,$3::jsonb) ON CONFLICT(workspace_id) DO UPDATE SET body=EXCLUDED.body',[workspaceId,a.vault.toLowerCase(),JSON.stringify(a)]);
 return loadLiveStudioView(db,workspaceId,owner);
}
