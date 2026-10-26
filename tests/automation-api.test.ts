import {afterEach,it,expect} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {ensureDemoAccount,createStudioDraft,reviseStudioDraft,loadStudioView,activateDemoPolicy,runDemoPeriod} from '../apps/web/src/server/automation/service';
const dbs:Database[]=[];afterEach(async()=>{await Promise.all(dbs.splice(0).map(d=>d.close()));});
async function setup(){const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('demo:a','demo'),('demo:b','demo')");await ensureDemoAccount(db,'demo:a',100);return db;}
const input={name:'Weekly contractor',recipient:'0x'+'22'.repeat(20),amount:'5',budget:'30',startAt:'100',endAt:'1000',intervalSeconds:'10',priority:'1'};
it('persists drafts, simulates and spends six sample periods without touching other workspaces',async()=>{
 const db=await setup(),draft=await createStudioDraft(db,'demo:a',input);
 expect((await loadStudioView(db,'demo:a')).rules[0].status).toBe('draft');
 await activateDemoPolicy(db,'demo:a',draft.policy.policyId,'30');
 for(let i=0;i<6;i++)await runDemoPeriod(db,'demo:a',100+i*10);
 const final=await runDemoPeriod(db,'demo:a',160);
 expect(final.account?.balance).toBe('20000000000000000000');expect(final.activity.filter(a=>a.state==='simulated')).toHaveLength(6);
 expect(final.rules[0].decision.reasonCode).toBe('LIFETIME_CAP');
 expect((await loadStudioView(db,'demo:b')).rules).toEqual([]);
});
it('keeps a shared allocation funded and cannot replay a sample period',async()=>{
 const db=await setup(),a=await createStudioDraft(db,'demo:a',input),b=await createStudioDraft(db,'demo:a',{...input,name:'Second rule'});
 await activateDemoPolicy(db,'demo:a',a.policy.policyId,'25');
 await expect(activateDemoPolicy(db,'demo:a',b.policy.policyId,'10')).rejects.toThrow(/budget|cash/i);
 await runDemoPeriod(db,'demo:a',100);await runDemoPeriod(db,'demo:a',100);
 expect((await loadStudioView(db,'demo:a')).activity.filter(a=>a.state==='simulated')).toHaveLength(1);
});
it('revisions require fresh approval and preserve allocation, consumed period and spent counters',async()=>{
 const db=await setup(),a=await createStudioDraft(db,'demo:a',input);await activateDemoPolicy(db,'demo:a',a.policy.policyId,'30');await runDemoPeriod(db,'demo:a',100);
 const revision=await reviseStudioDraft(db,'demo:a',a.policy.policyId,{...input,amount:'4'});expect(revision.policy.version).toBe('2');
 let view=await loadStudioView(db,'demo:a');expect(view.rules[0].status).toBe('draft');expect(view.account?.spent[a.policy.policyId]).toBe('5000000000000000000');
 await activateDemoPolicy(db,'demo:a',a.policy.policyId,'25');await runDemoPeriod(db,'demo:a',100);view=await loadStudioView(db,'demo:a');expect(view.account?.balance).toBe('45000000000000000000');
 await expect(reviseStudioDraft(db,'demo:a',a.policy.policyId,{...input,startAt:'101'})).rejects.toThrow(/schedule/);
});
