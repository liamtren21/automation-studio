import {randomUUID} from 'node:crypto';
import type {Database} from './database';
import type {ExecutionRecord} from '../../../apps/worker/src/automation/runner';
export interface BatchRunClaim {id:string;workspace:string;draftId:string;period:string;worker:string;fencingToken:string;leaseUntil:number;record:ExecutionRecord}
interface Row {id:string;workspace_id:string;draft_id:string;period_index:string;worker_id:string;fencing_token:string;lease_until:string;state:ExecutionRecord['state']|'simulated';body:Partial<ExecutionRecord>}
export async function claimBatchRun(db:Database,input:{workspace:string;draftId:string;period:string;worker:string;now:number}):Promise<BatchRunClaim|null>{
 if(!/^\d{1,78}$/.test(input.period)||!Number.isSafeInteger(input.now)||input.now<0)throw Error('Invalid group execution period.');
 return db.transaction(async q=>{
  const policy=await q.query('SELECT draft_id FROM studio_batch_policies WHERE workspace_id=$1 AND draft_id=$2 FOR UPDATE',[input.workspace,input.draftId]);if(!policy.rows.length)throw Error('Group execution policy not found.');
  const unresolved=await q.query("SELECT id FROM studio_batch_runs WHERE workspace_id=$1 AND draft_id=$2 AND period_index<>$3 AND (body ? 'signed') AND state NOT IN ('confirmed','reverted') LIMIT 1",[input.workspace,input.draftId,input.period]);if(unresolved.rows.length)return null;
  const row=(await q.query<Row>(`INSERT INTO studio_batch_runs(id,workspace_id,draft_id,version,period_index,state,worker_id,lease_until) VALUES($1,$2,$3,1,$4,'claimed',$5,$6)
   ON CONFLICT(workspace_id,draft_id,version,period_index) DO UPDATE SET worker_id=EXCLUDED.worker_id,lease_until=EXCLUDED.lease_until,fencing_token=studio_batch_runs.fencing_token+1,state=CASE WHEN studio_batch_runs.body ? 'signed' THEN studio_batch_runs.state ELSE 'claimed' END
   WHERE studio_batch_runs.lease_until<=$7 RETURNING id,workspace_id,draft_id,period_index::text,worker_id,fencing_token::text,lease_until::text,state,body`,[randomUUID(),input.workspace,input.draftId,input.period,input.worker,input.now+120,input.now])).rows[0];
  if(!row)return null;
  const record:ExecutionRecord={...row.body,id:row.id,state:row.state==='simulated'?'claimed':row.state,fencingToken:row.fencing_token,leaseUntil:Number(row.lease_until)};
  return {id:row.id,workspace:row.workspace_id,draftId:row.draft_id,period:row.period_index,worker:row.worker_id,fencingToken:row.fencing_token,leaseUntil:Number(row.lease_until),record};
 });
}
export async function assertBatchLease(db:Database,claim:BatchRunClaim,now:number){
 const result=await db.query('SELECT id FROM studio_batch_runs WHERE id=$1 AND workspace_id=$2 AND worker_id=$3 AND fencing_token=$4 AND lease_until>$5',[claim.id,claim.workspace,claim.worker,claim.fencingToken,now]);if(!result.rows.length)throw Error('Group run lease expired or lost.');
}
export async function saveBatchRun(db:Database,claim:BatchRunClaim,record:ExecutionRecord,now:number){
 if(record.id!==claim.id||record.fencingToken!==claim.fencingToken)throw Error('Group run lease does not match.');
 await db.transaction(async q=>{
  const previous=(await q.query<{body:Partial<ExecutionRecord>;state:string}>('SELECT body,state FROM studio_batch_runs WHERE id=$1 AND workspace_id=$2 AND worker_id=$3 AND fencing_token=$4 AND lease_until>$5 FOR UPDATE',[claim.id,claim.workspace,claim.worker,claim.fencingToken,now])).rows[0];if(!previous)throw Error('Group run lease expired or lost.');
  if(previous.body.signed&&(['hash','rawTransaction','nonce','executor','intentHash'] as const).some(k=>previous.body.signed![k]!==record.signed?.[k]))throw Error('Saved signed group intent cannot change.');
  if(!previous.body.signed&&record.signed&&record.state!=='signed')throw Error('Signed group journal must be saved before broadcast.');
  if(['pending','unknown','confirmed','reverted'].includes(record.state)&&!record.signed)throw Error('Submitted group execution requires its signed journal.');
  await q.query('UPDATE studio_batch_runs SET state=$2,body=$3::jsonb WHERE id=$1',[claim.id,record.state,JSON.stringify(record)]);
 });
}
/** Reclaims only a fenced, unsigned reservation after its payment window elapsed. */
export async function recoverUnsignedBatchReservation(db:Database,input:{executor:string;now:number;latestNonce:string;pendingNonce:string}){
 if(!/^0x[0-9a-f]{40}$/i.test(input.executor)||!Number.isSafeInteger(input.now)||input.now<0||!/^\d+$/.test(input.latestNonce)||input.latestNonce!==input.pendingNonce)return false;
 const candidate=(await db.query<{run_id:string}>("SELECT run_id FROM automation_executor_nonces WHERE chain_id=31611 AND executor=$1 AND state='unresolved'",[input.executor.toLowerCase()])).rows[0];if(!candidate)return false;
 return db.transaction(async q=>{
  const run=(await q.query<{id:string;workspace_id:string;draft_id:string;period_index:string;lease_until:string;state:string;body:Partial<ExecutionRecord>}>('SELECT id,workspace_id,draft_id,period_index::text,lease_until::text,state,body FROM studio_batch_runs WHERE id=$1 FOR UPDATE',[candidate.run_id])).rows[0];
  if(!run||run.body.signed||Number(run.lease_until)>input.now||!['claimed','simulated','blocked'].includes(run.state))return false;
  const nonce=(await q.query<{run_id:string;nonce:string}>("SELECT run_id,nonce::text FROM automation_executor_nonces WHERE chain_id=31611 AND executor=$1 AND state='unresolved' FOR UPDATE",[input.executor.toLowerCase()])).rows[0];
  if(!nonce||nonce.run_id!==run.id||nonce.nonce!==input.latestNonce)return false;
  const policy=(await q.query<{body:{draft:{schedule:{startAt:string;endAt:string;intervalSeconds:string}}}}>('SELECT body FROM studio_batch_policies WHERE workspace_id=$1 AND draft_id=$2',[run.workspace_id,run.draft_id])).rows[0];if(!policy)return false;
  const s=policy.body.draft.schedule,at=BigInt(input.now),start=BigInt(s.startAt),end=BigInt(s.endAt),interval=BigInt(s.intervalSeconds);
  if(interval<=0n||at<start)return false;
  if(at<end&&((at-start)/interval).toString()===run.period_index)return false;
  await q.query("UPDATE studio_batch_runs SET fencing_token=fencing_token+1,state='blocked',body=$2::jsonb WHERE id=$1",[run.id,JSON.stringify({reason:'Unsigned payment window ended. No transaction was sent.'})]);
  await q.query("UPDATE automation_executor_nonces SET state='released' WHERE chain_id=31611 AND executor=$1 AND run_id=$2",[input.executor.toLowerCase(),run.id]);return true;
 });
}
