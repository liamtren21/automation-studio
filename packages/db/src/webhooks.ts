import {createHash,randomUUID} from 'node:crypto';
import type {Database,Sql} from './database';
export type WebhookEventType='payment.confirmed'|'payment.blocked'|'payment.failed'|'payment.confirmation_lost';
export async function createWebhookEndpoint(db:Database,workspace:string,url:string,encryptedSecret:string) {
 return db.transaction(async q=>{
  await q.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
  if((await q.query('SELECT id FROM studio_webhook_endpoints WHERE workspace_id=$1',[workspace])).rows.length>=5)throw new Error('Maximum five webhook endpoints per workspace.');
  const id=randomUUID();await q.query('INSERT INTO studio_webhook_endpoints(id,workspace_id,url,secret_encrypted) VALUES($1,$2,$3,$4)',[id,workspace,url,encryptedSecret]);return {id,url,enabled:true};
 });
}
export async function enqueueRunWebhook(q:Sql,workspace:string,event:{runId:string;transitionVersion:number;type:WebhookEventType;data:Record<string,unknown>},now:number) {
 const id=createHash('sha256').update(`${workspace}:${event.runId}:${event.transitionVersion}:${event.type}`).digest('hex');
 const payload={eventId:id,type:event.type,createdAt:new Date(now*1000).toISOString(),data:event.data};
 await q.query(`INSERT INTO studio_webhook_outbox(id,event_id,endpoint_id,endpoint_revision,workspace_id,payload,next_due)
 SELECT $1||':'||id,$1,id,revision,workspace_id,$2::jsonb,$3 FROM studio_webhook_endpoints WHERE workspace_id=$4 AND enabled=true ON CONFLICT(event_id,endpoint_id) DO NOTHING`,[id,JSON.stringify(payload),now,workspace]);
}
