import {afterEach,expect,it} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {buildProtectionSource,currentProtection,saveProtectionSettings,assertCurrentCashProtection} from '../apps/web/src/server/automation/protection';
const dbs:Database[]=[];afterEach(async()=>{await Promise.all(dbs.splice(0).map(d=>d.close()));});
it('canonical standalone settings default to zero and hash only declared commitments and cushion',()=>{
 const zero=buildProtectionSource('live:owner','0','0');expect(zero.committedBills).toBe('0');expect(zero.protectedFloor).toBe('0');
 const first=buildProtectionSource('live:owner','10','5');expect(first.protectedFloor).toBe('15000000000000000000');
 expect(buildProtectionSource('live:owner','10.0','5.00').sourceHash).toBe(first.sourceHash);
 expect(buildProtectionSource('live:owner','11','5').sourceHash).not.toBe(first.sourceHash);
 expect(buildProtectionSource('live:other','10','5').sourceHash).not.toBe(first.sourceHash);
 expect(()=>buildProtectionSource('live:owner','-1','5')).toThrow();
});
it('persists settings per owner without importing workspace buffers or invoices or changing signed account state',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);
 await db.query("INSERT INTO workspaces(id,mode,balance,buffer) VALUES('demo:a','demo',0,300000000000000000000),('demo:b','demo',0,900000000000000000000)");
 expect((await currentProtection(db,'demo:a')).buffer).toBe('0');
 const before={committedBills:'0',buffer:'0',protectionSourceHash:'signed'};await db.query("INSERT INTO automation_accounts(workspace_id,mode,chain_id,vault,body) VALUES('demo:a','demo',31611,$1,$2::jsonb)",['0x'+'11'.repeat(20),JSON.stringify(before)]);
 const saved=await saveProtectionSettings(db,'demo:a',{committedBills:'12.5',cashCushion:'3'});expect(saved.committedBills).toBe('12500000000000000000');expect(saved.buffer).toBe('3000000000000000000');expect(await currentProtection(db,'demo:a')).toEqual(saved);
 expect((await currentProtection(db,'demo:b')).protectedFloor).toBe('0');expect((await db.query<{body:unknown}>("SELECT body FROM automation_accounts WHERE workspace_id='demo:a'")).rows[0].body).toEqual(before);
});

it('rejects stale or expired protection before allocation and withdrawal',()=>{const state={sourceHash:'0xAB',expires:'101',block:{timestamp:100n}};expect(()=>assertCurrentCashProtection(state,'0xab')).not.toThrow();expect(()=>assertCurrentCashProtection(state,'0xcd')).toThrow(/latest obligations/);expect(()=>assertCurrentCashProtection({...state,expires:'100'},'0xab')).toThrow(/latest obligations/);});
