import {readTransactionEvidence} from '../../../../packages/mezo/src/receipt-read';
import {createWalletClient,http,keccak256,encodeAbiParameters,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import type {Database} from '../../../../packages/db/src/database';
import {claimBatchRun,saveBatchRun,assertBatchLease,recoverUnsignedBatchReservation,type BatchRunClaim} from '../../../../packages/db/src/batch-runs';
import {executeClaimedRun,type ExecutionPorts,type ExecutionRecord} from './runner';
import {reserveExecutorNonce,settleExecutorNonce,assertExecutorNotQuarantined,quarantineExecutor,clearExecutorQuarantine} from './nonce-manager';
import {publicClient,mezoTestnet} from '../../../../packages/mezo/src/network';
import {batchConfiguration,batchExecutionData,verifyBatchReceipt} from '../../../../packages/mezo/src/automation-v2-batch';
import {loadBatchState,type BatchPolicyRow} from '../../../web/src/server/automation/v2-activation';
import {currentProtection} from '../../../web/src/server/automation/protection';
const now=()=>Math.floor(Date.now()/1000);
export async function batchAutomationTick(db:Database,workerId:string){
 if(process.env.STUDIO_V2_BATCH_EXECUTION!=='true'||process.env.STUDIO_AUTOMATION_EXECUTION!=='true')return {enabled:false,processed:0};
 if(!process.env.DATABASE_URL?.startsWith('postgres'))throw Error('Group execution requires durable PostgreSQL.');
 const key=process.env.STUDIO_EXECUTOR_PRIVATE_KEY;if(!key||!/^0x[0-9a-f]{64}$/i.test(key))throw Error('Group payment service signer is not configured.');
 const account=privateKeyToAccount(key as Hex);
 if(account.address.toLowerCase()!==process.env.STUDIO_EXECUTOR_ADDRESS?.toLowerCase())throw Error('Group executor does not match the configured service.');
 const p=publicClient();if(await p.getChainId()!==31611)throw Error('Wrong group execution chain.');
 const wallet=createWalletClient({account,chain:mezoTestnet,transport:http(process.env.MEZO_RPC_URL??'https://rpc.test.mezo.org')});
 const [latest,pending]=await Promise.all([p.getTransactionCount({address:account.address,blockTag:'latest'}),p.getTransactionCount({address:account.address,blockTag:'pending'})]);
 await recoverUnsignedBatchReservation(db,{executor:account.address,now:now(),latestNonce:String(latest),pendingNonce:String(pending)});
 const rows=(await db.query<BatchPolicyRow>('SELECT workspace_id,draft_id,account,policy_id,version::text,config_hash,body,status FROM studio_batch_policies ORDER BY workspace_id,draft_id LIMIT 50')).rows;
 const previous=(await db.query<{workspace_id:string;draft_id:string;period_index:string}>("SELECT workspace_id,draft_id,period_index::text FROM studio_batch_runs WHERE body ? 'signed' ORDER BY created_at DESC LIMIT 20")).rows;
 let processed=0;const seen=new Set<string>();
 for(const r of previous){const policy=rows.find(a=>a.workspace_id===r.workspace_id&&a.draft_id===r.draft_id);if(!policy)continue;const claim=await claimBatchRun(db,{workspace:r.workspace_id,draftId:r.draft_id,period:r.period_index,worker:workerId,now:now()});if(claim){seen.add(policy.workspace_id+':'+policy.draft_id);await processClaim(claim,policy);processed++;}}
 for(const row of rows.filter(r=>r.status==='active')){
  if(processed>=2||seen.has(row.workspace_id+':'+row.draft_id))continue;
  const state=await loadBatchState(db,row.workspace_id,row.draft_id);
  if(state.stopped){await db.query("UPDATE studio_batch_policies SET status='stopped' WHERE workspace_id=$1 AND draft_id=$2",[row.workspace_id,row.draft_id]);continue;}
  if(state.period===null||state.completed||state.consumed)continue;
  const claim=await claimBatchRun(db,{workspace:row.workspace_id,draftId:row.draft_id,period:state.period,worker:workerId,now:now()});if(claim){await processClaim(claim,row);processed++;}
 }
 return {enabled:true,processed};
 async function processClaim(claim:BatchRunClaim,row:BatchPolicyRow){
  const config=batchConfiguration(row.workspace_id,row.draft_id,row.body.account,row.body.draft),data=batchExecutionData(config.id,'1',claim.period),intentHash=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes'}],[31611n,row.body.account,data])),scope={chainId:'31611',executor:account.address};
  if(config.hash.toLowerCase()!==row.config_hash.toLowerCase()||row.account.toLowerCase()!==row.body.account.toLowerCase()||row.workspace_id!=='live:'+row.body.owner.toLowerCase()||row.body.owner.toLowerCase()===account.address.toLowerCase())throw Error('Stored group execution identity changed.');
  let loaded=claim.record;
  async function freshCheck(){
   await assertExecutorNotQuarantined(db,scope);
   const s=await loadBatchState(db,row.workspace_id,row.draft_id);
   if(s.record?.status!=='active'||s.step||s.blocked||s.stopped||s.expired||s.completed||s.paused||s.period!==claim.period||s.consumed||!s.protectedCash||!s.executorAllowed||s.config.hash.toLowerCase()!==config.hash.toLowerCase())throw Error(s.blocked??(s.step?'Finish group setup before sending.':'This group payment is no longer eligible.'));
   if(s.globalSpent+BigInt(row.body.draft.totalPerBatch)>BigInt(row.body.globalBudget))throw Error('The group spending limit is reached.');
   const gas=await p.getBalance({address:account.address,blockNumber:BigInt(s.preflight.snapshot.blockNumber)});if(gas===0n)throw Error('The payment service needs test BTC for fees.');
   await p.call({account:account.address,to:row.body.account,data,value:0n,blockNumber:BigInt(s.preflight.snapshot.blockNumber)});
   return s;
  }
  const ports:ExecutionPorts={now,
   load:async()=>loaded,
   save:async record=>{await saveBatchRun(db,claim,record,now());loaded=record;},
   simulate:async()=>{await freshCheck();await assertBatchLease(db,claim,now());},
   sign:async()=>{
    await assertBatchLease(db,claim,now());const [latest,pending]=await Promise.all([p.getTransactionCount({address:account.address,blockTag:'latest'}),p.getTransactionCount({address:account.address,blockTag:'pending'})]);
    const nonce=await reserveExecutorNonce(db,{...scope,runId:claim.id,latestNonce:String(latest),pendingNonce:String(pending),intentHash,fencingToken:claim.fencingToken,claim:{workspaceId:claim.workspace,workerId:claim.worker,now:String(now()),adapter:'v2-batch'}});
    const request=await wallet.prepareTransactionRequest({account,to:row.body.account,data,value:0n,nonce:Number(nonce)}),raw=await wallet.signTransaction(request);
    return {hash:keccak256(raw),rawTransaction:raw,nonce,executor:account.address,intentHash};
   },
   broadcast:async raw=>{await freshCheck();await assertBatchLease(db,claim,now());return p.sendRawTransaction({serializedTransaction:raw});},
   reconcile:async record=>{
    const signed=record.signed!;if(signed.intentHash!==intentHash||signed.executor.toLowerCase()!==account.address.toLowerCase())throw Error('Saved group execution intent changed.');
    const previouslyConfirmed=!!record.receiptBlockHash||['confirmed','reverted'].includes(record.state);
    let outcome:Awaited<ReturnType<ExecutionPorts['reconcile']>>;
    try{
     const [{tx,receipt},head]=await Promise.all([readTransactionEvidence(p,signed.hash),p.getBlockNumber()]),block=await p.getBlock({blockNumber:receipt.blockNumber});
     const status=verifyBatchReceipt({config,account:row.body.account,executor:account.address,period:claim.period,nonce:Number(signed.nonce),tx,receipt,canonicalBlockHash:block.hash});
     if(status==='pending'||head<receipt.blockNumber+1n)outcome={state:'pending'};
     else{
      const nonce=(await db.query<{state:string;nonce:string;run_id:string}>('SELECT state,nonce::text,run_id FROM automation_executor_nonces WHERE chain_id=31611 AND executor=$1',[account.address.toLowerCase()])).rows[0];
      if(nonce?.state==='unresolved'&&nonce.nonce===signed.nonce)await settleExecutorNonce(db,scope,claim.id,signed.nonce);
      else if(!nonce||BigInt(nonce.nonce)<BigInt(signed.nonce))throw Error('Group executor nonce journal is missing.');
      outcome={state:status,receiptBlock:receipt.blockNumber.toString(),receiptBlockHash:receipt.blockHash};
     }
    }catch{
     let visible=false;try{await p.getTransaction({hash:signed.hash});visible=true;}catch{}
     const [latest,pending]=await Promise.all([p.getTransactionCount({address:account.address,blockTag:'latest'}),p.getTransactionCount({address:account.address,blockTag:'pending'})]);
     outcome=visible?{state:'pending',reason:'The group transaction is visible; its receipt is still being checked.'}:{state:'unknown',reason:'Check the saved group transaction before sending anything else.',rebroadcastSamePayload:!previouslyConfirmed&&BigInt(latest)===BigInt(signed.nonce)&&BigInt(pending)===BigInt(signed.nonce)};
    }
    if(previouslyConfirmed&&!['confirmed','reverted'].includes(outcome.state))await quarantineExecutor(db,scope,claim.id,'Group receipt lost canonical confirmation.');
    if(['confirmed','reverted'].includes(outcome.state))await clearExecutorQuarantine(db,scope,claim.id);
    return outcome;
   },
  };
  try{await executeClaimedRun(ports,claim.id,claim.fencingToken);}catch(e){console.error('Group execution needs review',claim.id,e instanceof Error?e.name:'ExecutionUnavailable');}
 }
}
