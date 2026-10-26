import type {Database,Sql} from '../../../../packages/db/src/database';
import {integer,periodAt,type StudioPolicy} from '../../../../packages/automation/src/studio';
export interface ExecutorScope {chainId:string;executor:string}
/** Use a dedicated executor key. External transactions from it require reconciliation. */
export async function reserveExecutorNonce(db:Database,input:ExecutorScope&{runId:string;latestNonce:string;pendingNonce:string;intentHash:string;fencingToken:string;claim?:{workspaceId:string;workerId:string;now:string;adapter?:'v2-batch'}}):Promise<string> {
 const nonce=integer(input.latestNonce);if(integer(input.chainId)===0n||!/^0x[0-9a-f]{40}$/i.test(input.executor)||!input.runId)throw new Error('Invalid executor identity.');
 if(nonce!==integer(input.pendingNonce))throw new Error('Executor has an unidentified pending transaction.');
 if(!/^0x[0-9a-f]{64}$/i.test(input.intentHash)||integer(input.fencingToken)===0n)throw new Error('Invalid nonce intent or fencing token.');
 return db.transaction(async q=>{
  if(input.claim){const table=input.claim.adapter==='v2-batch'?'studio_batch_runs':'automation_runs';const lease=await q.query(`SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2 AND worker_id=$3 AND fencing_token=$4 AND lease_until>$5 AND state IN ('claimed','simulated') FOR UPDATE`,[input.runId,input.claim.workspaceId,input.claim.workerId,input.fencingToken,input.claim.now]);if(!lease.rows.length)throw new Error('Run lease rejected during nonce reservation.');}
  // The unique executor row serializes across every vault and workspace.
  const inserted=await q.query(`INSERT INTO automation_executor_nonces(chain_id,executor,run_id,nonce,state,intent_hash,fencing_token) VALUES($1,$2,$3,$4,'unresolved',$5,$6) ON CONFLICT DO NOTHING RETURNING run_id`,[input.chainId,input.executor.toLowerCase(),input.runId,input.latestNonce,input.intentHash.toLowerCase(),input.fencingToken]);
  await assertExecutorNotQuarantined(q,input);
  if(inserted.rows.length)return input.latestNonce;
  const result=await q.query<{run_id:string;nonce:string;state:string;intent_hash:string;fencing_token:string}>('SELECT run_id,nonce::text,state,intent_hash,fencing_token::text FROM automation_executor_nonces WHERE chain_id=$1 AND executor=$2 FOR UPDATE',[input.chainId,input.executor.toLowerCase()]);
  const row=result.rows[0];if(!row)throw new Error('Executor nonce lock missing.');
  await assertExecutorNotQuarantined(q,input);
  if(row.state==='released'){
   if(row.nonce!==input.latestNonce)throw new Error('Released executor nonce has unexplained chain activity.');
  }else if(row.state!=='settled'){
   if(row.run_id!==input.runId||row.intent_hash!==input.intentHash.toLowerCase()||row.nonce!==input.latestNonce)throw new Error('Executor has an unresolved payment. Reconcile it before signing.');
   if(integer(input.fencingToken)<=integer(row.fencing_token))throw new Error('Nonce reservation fencing token is stale.');
   await q.query('UPDATE automation_executor_nonces SET fencing_token=$3 WHERE chain_id=$1 AND executor=$2',[input.chainId,input.executor.toLowerCase(),input.fencingToken]);
   return row.nonce;
  }
  if(row.state==='settled'&&nonce<=BigInt(row.nonce))throw new Error('RPC returned a stale executor nonce.');
  if(row.state==='settled'&&nonce!==BigInt(row.nonce)+1n)throw new Error('Executor nonce gap requires explicit transaction reconciliation.');
  await q.query(`UPDATE automation_executor_nonces SET run_id=$3,nonce=$4,state='unresolved',intent_hash=$5,fencing_token=$6 WHERE chain_id=$1 AND executor=$2`,[input.chainId,input.executor.toLowerCase(),input.runId,input.latestNonce,input.intentHash.toLowerCase(),input.fencingToken]);
  return input.latestNonce;
 });
}
export async function assertExecutorNotQuarantined(db:Sql,scope:ExecutorScope) {
 const rows=await db.query('SELECT run_id FROM automation_executor_quarantines WHERE chain_id=$1 AND executor=$2 AND resolved=false LIMIT 1',[scope.chainId,scope.executor.toLowerCase()]);
 if(rows.rows.length)throw new Error('Executor is quarantined until earlier receipt evidence is reconciled.');
}
export async function quarantineExecutor(db:Database,scope:ExecutorScope,runId:string,reason:string) {
 await db.transaction(async q=>{
  await q.query('SELECT executor FROM automation_executor_nonces WHERE chain_id=$1 AND executor=$2 FOR UPDATE',[scope.chainId,scope.executor.toLowerCase()]);
  await q.query('INSERT INTO automation_executor_quarantines(chain_id,executor,run_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,executor,run_id) DO UPDATE SET resolved=false,reason=EXCLUDED.reason',[scope.chainId,scope.executor.toLowerCase(),runId,reason]);
 });
}
/** Only call after re-verifying canonical exact receipt evidence and confirmation depth. */
export async function clearExecutorQuarantine(db:Database,scope:ExecutorScope,runId:string) {
 await db.transaction(async q=>{await q.query('SELECT executor FROM automation_executor_nonces WHERE chain_id=$1 AND executor=$2 FOR UPDATE',[scope.chainId,scope.executor.toLowerCase()]);await q.query('UPDATE automation_executor_quarantines SET resolved=true WHERE chain_id=$1 AND executor=$2 AND run_id=$3',[scope.chainId,scope.executor.toLowerCase(),runId]);});
}
/** Release ONLY an expired lease with no signed journal, unchanged chain nonce, and an elapsed period.
 * Journaling is mandatory before broadcast; the fenced old worker can no longer journal or send.
 */
export async function recoverUnsignedReservation(db:Database,input:ExecutorScope&{now:string;latestNonce:string;pendingNonce:string}):Promise<boolean> {
 integer(input.now);integer(input.latestNonce);integer(input.pendingNonce);
 const candidate=(await db.query<{run_id:string}>('SELECT run_id FROM automation_executor_nonces WHERE chain_id=$1 AND executor=$2 AND state=\'unresolved\'',[input.chainId,input.executor.toLowerCase()])).rows[0];if(!candidate)return false;
 return db.transaction(async q=>{
  const run=(await q.query<{id:string;workspace_id:string;chain_id:string;vault:string;policy_id:string;version:string;period_index:string;lease_until:string;state:string}>('SELECT * FROM automation_runs WHERE id=$1 FOR UPDATE',[candidate.run_id])).rows[0];
  if(!run||!['claimed','simulated','blocked'].includes(run.state)||integer(run.lease_until)>integer(input.now))return false;
  const nonce=(await q.query<{run_id:string;nonce:string}>('SELECT run_id,nonce::text FROM automation_executor_nonces WHERE chain_id=$1 AND executor=$2 AND state=\'unresolved\' FOR UPDATE',[input.chainId,input.executor.toLowerCase()])).rows[0];
  if(!nonce||nonce.run_id!==run.id||nonce.nonce!==input.latestNonce||nonce.nonce!==input.pendingNonce)return false;
  if((await q.query('SELECT id FROM automation_attempts WHERE run_id=$1 LIMIT 1',[run.id])).rows.length)return false;
  const policy=(await q.query<{body:StudioPolicy}>('SELECT body FROM automation_policies WHERE workspace_id=$1 AND chain_id=$2 AND vault=$3 AND policy_id=$4 AND version=$5',[run.workspace_id,run.chain_id,run.vault,run.policy_id,run.version])).rows[0]?.body;
  if(!policy||periodAt(policy,input.now)===run.period_index)return false;
  await q.query("UPDATE automation_runs SET fencing_token=fencing_token+1,state='skipped',body=body||$2::jsonb WHERE id=$1",[run.id,JSON.stringify({reason:'Unsigned reservation expired; no transaction was journaled or broadcast.'})]);
  await q.query("UPDATE automation_executor_nonces SET state='released' WHERE chain_id=$1 AND executor=$2 AND run_id=$3",[input.chainId,input.executor.toLowerCase(),run.id]);
  return true;
 });
}
/** Caller must have verified a canonical receipt with the required confirmations. */
export async function settleExecutorNonce(db:Database,scope:ExecutorScope,runId:string,nonce:string) {
 integer(nonce);const result=await db.query(`UPDATE automation_executor_nonces SET state='settled' WHERE chain_id=$1 AND executor=$2 AND run_id=$3 AND nonce=$4 AND state='unresolved' RETURNING run_id`,[scope.chainId,scope.executor.toLowerCase(),runId,nonce]);
 if(!result.rows.length)throw new Error('Executor settlement does not match the reserved intent.');
}
