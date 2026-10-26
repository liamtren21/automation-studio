import {afterEach,it,expect} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {ensureDemoAccount,createStudioDraft,activateDemoPolicy,runDemoPeriod,updateDemoProtection,reallocateDemo} from '../apps/web/src/server/automation/service';
import {mutateOperation} from '../apps/web/src/server/automation/operations';
import {currentProtection} from '../apps/web/src/server/automation/protection';
const open:Database[]=[];afterEach(async()=>{await Promise.all(open.splice(0).map(d=>d.close()));});
it('new obligations block old protection until explicit refresh and cannot spend allocated cash',async()=>{
 const db=await createDatabase('memory://');open.push(db);const ws='demo:source';await db.query("INSERT INTO workspaces(id,mode) VALUES($1,'demo')",[ws]);await ensureDemoAccount(db,ws,100);
 const policy=await createStudioDraft(db,ws,{name:'Bot',recipient:'0x2222222222222222222222222222222222222222',amount:'5',budget:'30',startAt:'100',endAt:'1000',intervalSeconds:'10',priority:'1'});await activateDemoPolicy(db,ws,policy.policy.policyId,'30');
 await mutateOperation(db,ws,{action:'create_obligation',name:'Invoice',amount:'5',dueDate:'2026-10-27'});expect((await currentProtection(db,ws)).committedBills).toBe('15000000000000000000');
 const blocked=await runDemoPeriod(db,ws,100);expect(blocked.activity[0].reason).toBe('PROTECTION_STALE');await expect(updateDemoProtection(db,ws)).rejects.toThrow(/Release/);
 await reallocateDemo(db,ws,policy.policy.policyId,'25');await updateDemoProtection(db,ws);const after=await runDemoPeriod(db,ws,110);expect(after.account?.balance).toBe('45000000000000000000');expect(after.activity[0].state).toBe('simulated');
});
