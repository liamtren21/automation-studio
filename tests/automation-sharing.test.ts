import {it,expect,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {createAutomationShare,readAutomationShare,revokeAutomationShare,notifyAutomation} from '../apps/web/src/server/automation/shares';
const dbs:Database[]=[];afterEach(async()=>{await Promise.all(dbs.splice(0).map(d=>d.close()));});
it('shares only explicitly selected public fields and supports expiry/revocation/workspace isolation',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('a','demo'),('b','demo')");
 const publicData={chainId:'31611',vault:'0x'+'11'.repeat(20),name:'Public schedule',recipient:'0x'+'22'.repeat(20),amount:'5',startAt:'100',endAt:'1000',intervalSeconds:'10',lifetimeCap:'30',memo:'private'};
 const share=await createAutomationShare(db,'a',publicData,100,200);
 expect(await readAutomationShare(db,share.token,101)).not.toHaveProperty('memo');
 expect(await readAutomationShare(db,share.token,200)).toBeNull();
 await expect(revokeAutomationShare(db,'b',share.token)).rejects.toThrow();
 await revokeAutomationShare(db,'a',share.token);expect(await readAutomationShare(db,share.token,101)).toBeNull();
});
it('deduplicates notifications within a payment period and reason',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('a','demo')");
 const input={workspaceId:'a',chainId:'31611',vault:'0x'+'11'.repeat(20),policyId:'p',reason:'GAS_LOW',episode:'period-0',message:'Add test BTC to the executor.'};
 await notifyAutomation(db,input);await notifyAutomation(db,input);
 expect((await db.query('SELECT * FROM automation_notifications')).rows).toHaveLength(1);
});
