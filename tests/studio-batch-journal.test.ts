import {it,expect,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import type {SignedAttempt} from '../apps/worker/src/automation/runner';
import {claimBatchRun,saveBatchRun,recoverUnsignedBatchReservation} from '../packages/db/src/batch-runs';
import {reserveExecutorNonce} from '../apps/worker/src/automation/nonce-manager';
const dbs:Database[]=[];afterEach(async()=>{await Promise.all(dbs.splice(0).map(d=>d.close()));});
async function setup(){const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:a','live')");await db.query("INSERT INTO studio_batch_drafts(id,workspace_id,body) VALUES('d','live:a','{}')");await db.query("INSERT INTO studio_batch_policies(workspace_id,draft_id,account,policy_id,config_hash,body,status) VALUES('live:a','d','0xaccount','0xpolicy','0xhash','{}','active')");return db;}
it('claims a period only once and fences an expired worker before journal or broadcast',async()=>{
 const db=await setup(),a=await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'one',now:100});expect(a).not.toBeNull();
 expect(await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'two',now:101})).toBeNull();
 const b=await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'two',now:221});expect(b?.fencingToken).not.toBe(a?.fencingToken);
 await expect(saveBatchRun(db,a!,{id:a!.id,state:'pending',fencingToken:a!.fencingToken,leaseUntil:999},222)).rejects.toThrow(/lease/i);
});
it('preserves the same signed bytes across recovery and refuses a different intent',async()=>{
 const db=await setup(),a=(await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'one',now:100}))!;
 const signed:SignedAttempt={hash:('0x'+'12'.repeat(32)) as `0x${string}`,rawTransaction:'0x1234',nonce:'1',executor:'0x'+'11'.repeat(20),intentHash:'0x'+'23'.repeat(32)};
 await saveBatchRun(db,a,{id:a.id,state:'signed',signed,fencingToken:a.fencingToken,leaseUntil:a.leaseUntil},101);
 const b=(await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'two',now:221}))!;expect(b.record.signed).toEqual(signed);expect(b.record.state).toBe('signed');
 await saveBatchRun(db,b,{...b.record,state:'pending',signed:{intentHash:signed.intentHash,executor:signed.executor,nonce:signed.nonce,rawTransaction:signed.rawTransaction,hash:signed.hash} as typeof signed},222);
 await expect(saveBatchRun(db,b,{...b.record,signed:{...signed,rawTransaction:'0x5678'}},222)).rejects.toThrow(/signed/i);
 expect(await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'1',worker:'three',now:222})).toBeNull();
});
it('only releases a nonce after an unsigned fenced window expires with unchanged chain counters',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:a','live')");await db.query("INSERT INTO studio_batch_drafts(id,workspace_id,body) VALUES('d','live:a','{}')");
 await db.query("INSERT INTO studio_batch_policies(workspace_id,draft_id,account,policy_id,config_hash,body,status) VALUES('live:a','d','0xaccount','0xpolicy','0xhash',$1::jsonb,'active')",[JSON.stringify({draft:{schedule:{startAt:'100',endAt:'300',intervalSeconds:'100'}}})]);
 const a=(await claimBatchRun(db,{workspace:'live:a',draftId:'d',period:'0',worker:'one',now:100}))!,executor='0x'+'11'.repeat(20);
 await reserveExecutorNonce(db,{chainId:'31611',executor,runId:a.id,latestNonce:'1',pendingNonce:'1',intentHash:'0x'+'12'.repeat(32),fencingToken:a.fencingToken,claim:{workspaceId:'live:a',workerId:'one',now:'101',adapter:'v2-batch'}});
 expect(await recoverUnsignedBatchReservation(db,{executor,now:150,latestNonce:'1',pendingNonce:'1'})).toBe(false);
 expect(await recoverUnsignedBatchReservation(db,{executor,now:221,latestNonce:'1',pendingNonce:'2'})).toBe(false);
 expect(await recoverUnsignedBatchReservation(db,{executor,now:221,latestNonce:'1',pendingNonce:'1'})).toBe(true);
 await expect(saveBatchRun(db,a,a.record,222)).rejects.toThrow(/lease/i);
 expect((await db.query<{state:string}>('SELECT state FROM automation_executor_nonces')).rows[0]?.state).toBe('released');
});
