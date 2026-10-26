import {it,expect,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {createAutomationPolicy,claimAutomationRun,updateAutomationRun,addAutomationAttempt} from '../packages/db/src/automation';
import {reserveExecutorNonce,settleExecutorNonce,recoverUnsignedReservation,quarantineExecutor,clearExecutorQuarantine,assertExecutorNotQuarantined} from '../apps/worker/src/automation/nonce-manager';
const dbs:Database[]=[];afterEach(async()=>{await Promise.all(dbs.splice(0).map(d=>d.close()));});
const scope={chainId:'31611',executor:'0x1111111111111111111111111111111111111111'},intentHash='0x'+'22'.repeat(32);
const policy={chainId:'31611',vault:'0x3333333333333333333333333333333333333333',policyId:'0x'+'44'.repeat(32) as `0x${string}`,version:'1',recipient:'0x5555555555555555555555555555555555555555',amount:'5',startAt:'100',endAt:'1000',intervalSeconds:'100',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'30',priority:'1',enabled:true} as const;
it('recovers an expired-period unsigned reservation and fences the old worker before nonce reuse',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('a','live')");await createAutomationPolicy(db,'a',policy);
 const key={workspaceId:'a',chainId:'31611',vault:policy.vault,policyId:policy.policyId,version:'1',workerId:'old',now:'100',leaseSeconds:'10',periodIndex:'0'};
 const first=(await claimAutomationRun(db,key))!;await updateAutomationRun(db,first,{state:'simulated'},'101');
 await reserveExecutorNonce(db,{...scope,runId:first.id,intentHash,fencingToken:'1',latestNonce:'0',pendingNonce:'0'});
 expect(await recoverUnsignedReservation(db,{...scope,now:'109',latestNonce:'0',pendingNonce:'0'})).toBe(false);
 expect(await recoverUnsignedReservation(db,{...scope,now:'110',latestNonce:'0',pendingNonce:'0'})).toBe(false);
 expect(await recoverUnsignedReservation(db,{...scope,now:'200',latestNonce:'1',pendingNonce:'1'})).toBe(false);
 expect(await recoverUnsignedReservation(db,{...scope,now:'200',latestNonce:'0',pendingNonce:'0'})).toBe(true);
 await expect(addAutomationAttempt(db,first,{attemptId:'late',nonce:'0',intent:{},rawTransaction:'0xab',txHash:null},'200')).rejects.toThrow();
 const second=(await claimAutomationRun(db,{...key,workerId:'new',now:'200',periodIndex:'1'}))!;
 expect(await reserveExecutorNonce(db,{...scope,runId:second.id,intentHash:'0x'+'66'.repeat(32),fencingToken:second.fencingToken,latestNonce:'0',pendingNonce:'0'})).toBe('0');
});
it('never releases a reservation that has a durable signed journal after the period expires',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('a','live')");await createAutomationPolicy(db,'a',policy);
 const run=(await claimAutomationRun(db,{workspaceId:'a',chainId:'31611',vault:policy.vault,policyId:policy.policyId,version:'1',workerId:'old',now:'100',leaseSeconds:'10',periodIndex:'0'}))!;
 await updateAutomationRun(db,run,{state:'simulated'},'101');await reserveExecutorNonce(db,{...scope,runId:run.id,intentHash,fencingToken:'1',latestNonce:'0',pendingNonce:'0'});
 await addAutomationAttempt(db,run,{attemptId:'signed',nonce:'0',intent:{},rawTransaction:'0xab',txHash:null},'102');
 expect(await recoverUnsignedReservation(db,{...scope,now:'200',latestNonce:'0',pendingNonce:'0'})).toBe(false);
});
it('quarantines reorg evidence independently of an advanced nonce and only clears that run after resolution',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);
 await reserveExecutorNonce(db,{...scope,runId:'old',intentHash,fencingToken:'1',latestNonce:'0',pendingNonce:'0'});await settleExecutorNonce(db,scope,'old','0');
 await reserveExecutorNonce(db,{...scope,runId:'next',intentHash,fencingToken:'1',latestNonce:'1',pendingNonce:'1'});
 await quarantineExecutor(db,scope,'old','Receipt lost canonicality');
 await expect(assertExecutorNotQuarantined(db,scope)).rejects.toThrow(/quarantine/i);
 await settleExecutorNonce(db,scope,'next','1');
 await expect(reserveExecutorNonce(db,{...scope,runId:'third',intentHash,fencingToken:'1',latestNonce:'2',pendingNonce:'2'})).rejects.toThrow(/quarantine/i);
 await clearExecutorQuarantine(db,scope,'other');await expect(assertExecutorNotQuarantined(db,scope)).rejects.toThrow();
 await clearExecutorQuarantine(db,scope,'old');expect(await reserveExecutorNonce(db,{...scope,runId:'third',intentHash,fencingToken:'1',latestNonce:'2',pendingNonce:'2'})).toBe('2');
});
