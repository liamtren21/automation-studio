import {randomUUID} from 'node:crypto';
import type {Database} from '../../../../../packages/db/src/database';
import {validateBatchDraft,type BatchDraft} from '../../../../../packages/automation/src/studio/batch';
export interface SavedBatchDraft {id:string;draft:BatchDraft;status:'draft';createdAt:string}
export async function listBatchDrafts(db:Database,workspace:string):Promise<SavedBatchDraft[]>{
 const result=await db.query<{id:string;body:BatchDraft;created_at:string}>('SELECT id,body,created_at FROM studio_batch_drafts WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 100',[workspace]);
 return result.rows.map(r=>({id:r.id,draft:r.body,status:'draft',createdAt:String(r.created_at)}));
}
export async function saveBatchDraft(db:Database,workspace:string,input:unknown):Promise<SavedBatchDraft>{
 const draft=validateBatchDraft(input),id=randomUUID();
 return db.transaction(async q=>{
  await q.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
  const count=(await q.query<{count:string}>('SELECT count(*)::text AS count FROM studio_batch_drafts WHERE workspace_id=$1',[workspace])).rows[0]!;
  if(Number(count.count)>=100)throw new Error('You have 100 saved group payments. Remove an unused draft before adding another.');
  const row=(await q.query<{created_at:string}>('INSERT INTO studio_batch_drafts(id,workspace_id,body) VALUES($1,$2,$3::jsonb) RETURNING created_at',[id,workspace,JSON.stringify(draft)])).rows[0]!;
  return {id,draft,status:'draft',createdAt:String(row.created_at)};
 });
}
export async function deleteBatchDraft(db:Database,workspace:string,id:string){
 const result=await db.query('DELETE FROM studio_batch_drafts WHERE workspace_id=$1 AND id=$2 RETURNING id',[workspace,id]);
 if(!result.rows.length)throw new Error('Group payment draft not found.');
}
