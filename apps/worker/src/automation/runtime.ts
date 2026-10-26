import {readTransactionEvidence} from '../../../../packages/mezo/src/receipt-read';
import {createWalletClient,encodeFunctionData,http,keccak256,encodeAbiParameters,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import type {Database} from '../../../../packages/db/src/database';
import {claimAutomationRun,acquireReconciliationLease,listAutomationRuns,listAutomationPolicies,updateAutomationRun,addAutomationAttempt,listAutomationAttempts,type RunClaim} from '../../../../packages/db/src/automation';
import {decideStudio,hashPolicy,periodAt,type StudioPolicy} from '../../../../packages/automation/src/studio';
import {automationVaultAbi} from '../../../../packages/mezo/src/automation-abi';
import {publicClient,mezoTestnet} from '../../../../packages/mezo/src/network';
import {readAutomationPolicy,readAutomationVault} from '../../../../packages/mezo/src/automation-chain';
import {verifyAutomationReceipt} from '../../../../packages/mezo/src/automation-receipt';
import {currentProtection} from '../../../web/src/server/automation/live';
import {latestRules,loadStudioAccount} from '../../../web/src/server/automation/service';
import {reserveExecutorNonce,settleExecutorNonce,recoverUnsignedReservation,assertExecutorNotQuarantined,quarantineExecutor,clearExecutorQuarantine} from './nonce-manager';
import {executeClaimedRun,type ExecutionPorts,type ExecutionRecord,type SignedAttempt,type Reconciliation} from './runner';
import {notifyAutomation} from '../../../web/src/server/automation/shares';

const now=()=>Math.floor(Date.now()/1000);
function serializedPolicy(p:Awaited<ReturnType<typeof readAutomationPolicy>>['actual']):StudioPolicy {
 return {...p,chainId:p.chainId.toString(),version:p.version.toString(),amount:p.amount.toString(),startAt:p.startAt.toString(),endAt:p.endAt.toString(),intervalSeconds:p.intervalSeconds.toString(),perRunCap:p.perRunCap.toString(),perPeriodCap:p.perPeriodCap.toString(),lifetimeCap:p.lifetimeCap.toString(),priority:p.priority.toString()};
}
export async function automationTick(db:Database,workerId:string) {
 if(process.env.STUDIO_AUTOMATION_EXECUTION!=='true')return;
 if(!process.env.DATABASE_URL?.startsWith('postgres'))throw new Error('Automation execution requires durable PostgreSQL.');
 const key=process.env.STUDIO_EXECUTOR_PRIVATE_KEY;
 if(!key||!/^0x[0-9a-f]{64}$/i.test(key))throw new Error('Configure a dedicated restricted executor signer. Never use the owner key.');
 const account=privateKeyToAccount(key as Hex),p=publicClient();if(await p.getChainId()!==31611)throw new Error('Wrong executor chain.');
 if(process.env.STUDIO_EXECUTOR_ADDRESS&&process.env.STUDIO_EXECUTOR_ADDRESS.toLowerCase()!==account.address.toLowerCase())throw new Error('Configured executor address does not match the restricted signer.');
 const wallet=createWalletClient({account,chain:mezoTestnet,transport:http(process.env.MEZO_RPC_URL??'https://rpc.test.mezo.org')});
 const confirmations=Number(process.env.STUDIO_AUTOMATION_CONFIRMATIONS??'2');if(!Number.isSafeInteger(confirmations)||confirmations<2)throw new Error('At least two confirmations are required.');
 const [latestNonce,pendingNonce]=await Promise.all([p.getTransactionCount({address:account.address,blockTag:'latest'}),p.getTransactionCount({address:account.address,blockTag:'pending'})]);
 await recoverUnsignedReservation(db,{chainId:'31611',executor:account.address,now:String(now()),latestNonce:String(latestNonce),pendingNonce:String(pendingNonce)});
 const spaces=await db.query<{workspace_id:string}>('SELECT workspace_id FROM automation_accounts WHERE mode=\'live\'');
 for(const space of spaces.rows){
  const workspaceId=space.workspace_id,binding=await loadStudioAccount(db,workspaceId);if(!binding||binding.mode!=='live')continue;
  if(binding.owner.toLowerCase()===account.address.toLowerCase())throw new Error('Executor must not use the owner key.');
  const rules=latestRules(await listAutomationPolicies(db,workspaceId));
  const vaultState=await readAutomationVault(binding.vault,binding.owner),head=vaultState.block,source=await currentProtection(db,workspaceId),gas=await p.getBalance({address:account.address,blockNumber:head.number});
  for(const r of rules.filter(r=>r.status==='active')){
   const notify=(reason:string,message:string,episode:string)=>notifyAutomation(db,{workspaceId,chainId:'31611',vault:binding.vault,policyId:r.policy.policyId,reason,message,episode});
   if(BigInt(r.policy.endAt)>head.timestamp&&BigInt(r.policy.endAt)<=head.timestamp+86400n)await notify('EXPIRING','This payment permission ends within 24 hours. Review its end date.',r.policy.version);
   if(BigInt(vaultState.expires)<=head.timestamp+21600n)await notify('PROTECTION_EXPIRING','Cash protection needs an owner refresh before future payments can run.',vaultState.expires);
   if(source.sourceHash.toLowerCase()!==vaultState.sourceHash.toLowerCase())await notify('PROTECTION_STALE','Declared commitments or your cash cushion changed. Review updated onchain protection.',source.sourceHash);
   if(gas===0n)await notify('GAS_LOW','Add test BTC to the dedicated executor to pay network fees.',String(head.timestamp/86400n));
  }
  await db.query("UPDATE automation_accounts SET body=jsonb_set(body,'{worker}',$2::jsonb) WHERE workspace_id=$1",[workspaceId,JSON.stringify({at:String(now()),executor:account.address})]);
  const previous=await listAutomationRuns(db,workspaceId);
  for(const run of previous.filter(r=>['submitted','pending','unknown','replaced','confirmed','reverted'].includes(r.state))){
   const claim=await acquireReconciliationLease(db,{workspaceId,runId:run.id,workerId,now:String(now()),leaseSeconds:'120'});if(!claim)continue;
   const row=rules.find(r=>r.policy.policyId.toLowerCase()===run.policyId.toLowerCase()&&r.policy.version===run.version)??(await listAutomationPolicies(db,workspaceId)).find(r=>r.policy.policyId.toLowerCase()===run.policyId.toLowerCase()&&r.policy.version===run.version);
   if(row)await processRun(claim,row.policy);
  }
  for(const row of rules.filter(r=>r.status==='active')){
   const block=await p.getBlock(),period=periodAt(row.policy,block.timestamp.toString());if(period===null)continue;
   const claim=await claimAutomationRun(db,{workspaceId,chainId:'31611',vault:binding.vault,policyId:row.policy.policyId,version:row.policy.version,periodIndex:period,workerId,now:String(now()),leaseSeconds:'120'});
   if(claim)await processRun(claim,row.policy);
  }
  async function processRun(claim:RunClaim,policy:StudioPolicy){
   const data=encodeFunctionData({abi:automationVaultAbi,functionName:'executePayout',args:[policy.policyId,BigInt(policy.version),BigInt(claim.periodIndex)]});
   const intentHash=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes'}],[31611n,policy.vault,data]));
   let loaded:ExecutionRecord;
   const ports:ExecutionPorts={now,
    load:async()=>{
     const run=(await listAutomationRuns(db,workspaceId)).find(r=>r.id===claim.id);if(!run)throw new Error('Run missing.');
     const body=run.body as Partial<ExecutionRecord>,attempts=await listAutomationAttempts(db,workspaceId,claim.id),attempt=attempts[0] as {raw_transaction:string;tx_hash:string;nonce:string;intent:{executor:string;intentHash:string}}|undefined;
     loaded={...body,id:run.id,fencingToken:run.fencingToken,leaseUntil:Number(run.leaseUntil),state:run.state==='submitted'?'signed':run.state==='simulated'?'claimed':run.state as ExecutionRecord['state'],...(attempt?{signed:{hash:attempt.tx_hash as Hex,rawTransaction:attempt.raw_transaction as Hex,nonce:attempt.nonce,executor:attempt.intent.executor,intentHash:attempt.intent.intentHash}}:{})};return loaded;
    },
    save:async record=>{
     const body={...record,requiredAmount:policy.amount,txHash:record.signed?.hash,policyHash:hashPolicy(policy)};
     if(record.state==='signed'){
      if(!record.signed)throw new Error('Signed journal required.');
      await addAutomationAttempt(db,claim,{attemptId:'initial',nonce:record.signed.nonce,intent:{executor:account.address,intentHash,to:policy.vault,data,policyHash:hashPolicy(policy),requiredAmount:policy.amount},rawTransaction:record.signed.rawTransaction,txHash:record.signed.hash},String(now()));
     }else await updateAutomationRun(db,claim,{state:record.state==='claimed'?'claimed':record.state,body},String(now()));
     if(['blocked','unknown','reverted'].includes(record.state))await notifyAutomation(db,{workspaceId,chainId:'31611',vault:policy.vault,policyId:policy.policyId,reason:record.reason??record.state,episode:claim.periodIndex,message:record.reason??'Review this payment before continuing.'});
    },
    simulate:async()=>{
     const source=await currentProtection(db,workspaceId),state=await readAutomationPolicy(policy,binding!.owner,source.sourceHash,account.address);
     if(!state.enabledExecutor||state.vault.paused||hashPolicy(serializedPolicy(state.actual))!==hashPolicy(policy))throw new Error('Executor or approved policy is no longer active.');
     const gas=await p.getBalance({address:account.address,blockNumber:state.vault.block.number});
     const d=decideStudio({...state.snapshot,expectedPeriodIndex:claim.periodIndex,gasAvailable:gas>0n},policy);if(!d.allowed)throw new Error(d.reasonCode);
     await p.call({account:account.address,to:policy.vault,data,value:0n,blockNumber:state.vault.block.number});
     await updateAutomationRun(db,claim,{state:'simulated',body:{requiredAmount:policy.amount,snapshotBlock:state.snapshot.blockNumber,sourceHash:source.sourceHash}},String(now()));
    },
    sign:async()=>{
     const [latest,pending]=await Promise.all([p.getTransactionCount({address:account.address,blockTag:'latest'}),p.getTransactionCount({address:account.address,blockTag:'pending'})]);
     const nonce=await reserveExecutorNonce(db,{chainId:'31611',executor:account.address,runId:claim.id,latestNonce:String(latest),pendingNonce:String(pending),intentHash,fencingToken:claim.fencingToken,claim:{workspaceId,workerId,now:String(now())}});
     const request=await wallet.prepareTransactionRequest({account,to:policy.vault,data,value:0n,nonce:Number(nonce)});
     const raw=await wallet.signTransaction(request);return {hash:keccak256(raw),rawTransaction:raw,nonce,executor:account.address,intentHash};
    },
    broadcast:async raw=>{
     await assertExecutorNotQuarantined(db,{chainId:'31611',executor:account.address});
     // Recheck offchain protection immediately before submitting. Onchain snapshot remains the contract guarantee.
     const source=await currentProtection(db,workspaceId),state=await readAutomationPolicy(policy,binding!.owner,source.sourceHash,account.address);
     const d=decideStudio({...state.snapshot,expectedPeriodIndex:claim.periodIndex},policy);if(!d.allowed||!state.enabledExecutor||state.vault.paused)throw new Error('Automation source or execution conditions changed.');
     const rows=await db.query('SELECT id FROM automation_runs WHERE id=$1 AND workspace_id=$2 AND worker_id=$3 AND fencing_token=$4 AND lease_until>$5',[claim.id,workspaceId,workerId,claim.fencingToken,String(now())]);if(!rows.rows.length)throw new Error('Execution lease lost before broadcast.');
     await assertExecutorNotQuarantined(db,{chainId:'31611',executor:account.address});
     return p.sendRawTransaction({serializedTransaction:raw});
    },
    reconcile:async record=>{
     const signed=record.signed!;if(signed.intentHash!==intentHash)throw new Error('Saved executor intent changed.');
     const receiptExecutor=signed.executor as Address;
     let receipt,tx;
     try{({receipt,tx}=await readTransactionEvidence(p,signed.hash));}
     catch{
      try{await p.getTransaction({hash:signed.hash});return {state:'pending',reason:'The saved transaction is visible; its receipt is still pending.'};}catch{}
      const [latest,pending]=await Promise.all([p.getTransactionCount({address:receiptExecutor,blockTag:'latest'}),p.getTransactionCount({address:receiptExecutor,blockTag:'pending'})]);
      return {state:'unknown',reason:'Existing transaction is not visible. Only its identical signed payload may be retried.',rebroadcastSamePayload:receiptExecutor.toLowerCase()===account.address.toLowerCase()&&BigInt(latest)===BigInt(signed.nonce)&&BigInt(pending)===BigInt(signed.nonce)};
     }
     const [block,head]=await Promise.all([p.getBlock({blockNumber:receipt.blockNumber}),p.getBlockNumber()]);
     const status=verifyAutomationReceipt({vault:policy.vault,recipient:policy.recipient,executor:receiptExecutor,token:binding!.token,policyId:policy.policyId,version:policy.version,periodIndex:claim.periodIndex,amount:policy.amount,policyHash:hashPolicy(policy),nonce:Number(signed.nonce),expectedData:data,tx,receipt,canonicalBlockHash:block.hash});
     if(status==='pending'||head<receipt.blockNumber+BigInt(confirmations-1))return {state:'pending'};
     // Idempotent settlement is verified against the durable nonce row, not just the receipt status.
     const nonceRows=await db.query<{state:string;nonce:string;run_id:string}>('SELECT state,nonce::text,run_id FROM automation_executor_nonces WHERE chain_id=31611 AND executor=$1',[receiptExecutor.toLowerCase()]);
     const nonceRow=nonceRows.rows[0];if(nonceRow?.state==='unresolved'&&nonceRow.nonce===signed.nonce)await settleExecutorNonce(db,{chainId:'31611',executor:receiptExecutor},claim.id,signed.nonce);
     else if(!nonceRow||BigInt(nonceRow.nonce)<BigInt(signed.nonce))throw new Error('Executor nonce journal missing.');
     return {state:status,receiptBlock:receipt.blockNumber.toString(),receiptBlockHash:receipt.blockHash} as Reconciliation;
    },
   };
   const readReceipt=ports.reconcile;
   ports.reconcile=async record=>{
    const scope={chainId:'31611',executor:record.signed?.executor??account.address},previouslySettled=!!record.receiptBlockHash||record.state==='confirmed'||record.state==='reverted';
    try{const result=await readReceipt(record);if(previouslySettled&&!['confirmed','reverted'].includes(result.state))await quarantineExecutor(db,scope,claim.id,'Earlier receipt lost canonical confirmation.');else if(['confirmed','reverted'].includes(result.state))await clearExecutorQuarantine(db,scope,claim.id);return result;}
    catch(error){if(previouslySettled)await quarantineExecutor(db,scope,claim.id,'Earlier receipt could not be verified.');throw error;}
   };
   try{await executeClaimedRun(ports,claim.id,claim.fencingToken);}catch(error){
    console.error('Automation run needs attention',claim.id,error instanceof Error?error.name:'ExecutionUnavailable');
    try{const attempts=await listAutomationAttempts(db,workspaceId,claim.id);if(!attempts.length){await updateAutomationRun(db,claim,{state:'blocked',body:{requiredAmount:policy.amount,reason:'EXECUTION_REVIEW_REQUIRED'}},String(now()));await notifyAutomation(db,{workspaceId,chainId:'31611',vault:policy.vault,policyId:policy.policyId,reason:'EXECUTION_REVIEW_REQUIRED',episode:claim.periodIndex,message:'The executor could not prepare this payment. Check earlier transactions, gas and worker configuration.'});}}catch{/* A lost lease must not overwrite the replacement worker. */}
   }
  }
 }
}
