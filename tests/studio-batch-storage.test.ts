import {it,expect,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {createBatchDraft} from '../packages/automation/src/studio/batch';
import {listBatchDrafts,saveBatchDraft,deleteBatchDraft} from '../apps/web/src/server/automation/batch-drafts';
const databases:Database[]=[];afterEach(async()=>{await Promise.all(databases.splice(0).map(db=>db.close()));});
async function setup(){const db=await createDatabase('memory://');databases.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('demo:a','demo'),('live:b','live')");return db;}
const draft=()=>createBatchDraft({name:'Team payments',recipients:[{address:'0x1111111111111111111111111111111111111111',amount:'0.01'},{address:'0x2222222222222222222222222222222222222222',amount:'0.01'}],schedule:{kind:'daily',startAt:'1793000000',endAt:'1793172800'},lifetimeBudget:'0.04'});
it('stores a reloadable batch draft without making it executable or touching existing bots',async()=>{
 const db=await setup(),saved=await saveBatchDraft(db,'demo:a',draft());
 expect(saved.status).toBe('draft');expect(saved.draft.enabled).toBe(false);
 expect((await listBatchDrafts(db,'demo:a'))[0]?.draft).toEqual(draft());
 expect((await db.query('SELECT * FROM automation_policies')).rows).toHaveLength(0);
 expect((await db.query('SELECT * FROM studio_v2_accounts')).rows).toHaveLength(0);
});
it('isolates draft reads and deletion by workspace',async()=>{
 const db=await setup(),saved=await saveBatchDraft(db,'demo:a',draft());
 expect(await listBatchDrafts(db,'live:b')).toHaveLength(0);
 await expect(deleteBatchDraft(db,'live:b',saved.id)).rejects.toThrow('not found');
 expect(await listBatchDrafts(db,'demo:a')).toHaveLength(1);
 await deleteBatchDraft(db,'demo:a',saved.id);expect(await listBatchDrafts(db,'demo:a')).toHaveLength(0);
});
it('rejects tampered aggregate amounts or enabled flags before saving',async()=>{
 const db=await setup();
 await expect(saveBatchDraft(db,'demo:a',{...draft(),enabled:true})).rejects.toThrow();
 await expect(saveBatchDraft(db,'demo:a',{...draft(),totalPerBatch:'1'})).rejects.toThrow();
 expect(await listBatchDrafts(db,'demo:a')).toHaveLength(0);
});
