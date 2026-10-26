import {randomUUID} from 'node:crypto';
import type {Database} from '../../../../packages/db/src/database';
import {postWebhook,unprotectWebhookSecret,webhookSignature} from '../../../web/src/server/automation/webhooks';
interface Claim {id:string;payload:unknown;attempts:number;url:string;secret_encrypted:string;endpoint_revision:number;revision:number;enabled:boolean}
export async function deliverWebhookBatch(db:Database,options:{now?:number;key?:string;limit?:number;transport?:typeof postWebhook}={}) {
 const now=options.now??Math.floor(Date.now()/1000),key=options.key??process.env.STUDIO_WEBHOOK_ENCRYPTION_KEY;
 if(!key)return {delivered:0,failed:0,configured:false};
 let delivered=0,failed=0;
 for(let i=0;i<Math.min(options.limit??2,10);i++){
  const lease=randomUUID();
  const claim=await db.transaction(async q=>{
   const row=(await q.query<Claim>(`SELECT o.id,o.payload,o.attempts,o.endpoint_revision,e.revision,e.url,e.secret_encrypted,e.enabled FROM studio_webhook_outbox o JOIN studio_webhook_endpoints e ON e.id=o.endpoint_id WHERE o.status IN('pending','delivering') AND o.next_due<=$1 AND o.lease_until<=$1 ORDER BY o.next_due,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,[now])).rows[0];
   if(!row)return null;
   if(!row.enabled||row.endpoint_revision!==row.revision){await q.query("UPDATE studio_webhook_outbox SET status='cancelled' WHERE id=$1",[row.id]);return {cancelled:true} as const;}
   await q.query("UPDATE studio_webhook_outbox SET status='delivering',lease_token=$2,lease_until=$3,attempts=attempts+1 WHERE id=$1",[row.id,lease,now+30]);return row;
  });
  if(!claim)break;if('cancelled' in claim)continue;
  let status:number|null=null,error:string|null=null;
  try{const secret=unprotectWebhookSecret(claim.secret_encrypted,key),body=JSON.stringify(claim.payload),timestamp=String(now);status=(await (options.transport??postWebhook)(claim.url,body,{'x-studio-timestamp':timestamp,'x-studio-signature':webhookSignature(secret,timestamp,body),'x-studio-event-id':(claim.payload as {eventId:string}).eventId})).status;}catch{error='Delivery unavailable. Check the endpoint and retry this notification.';}
  const success=status!==null&&status>=200&&status<300,attempt=claim.attempts+1,delays=[60,300,1800,7200,43200],state=success?'delivered':attempt>=6?'failed':'pending';
  await db.transaction(async q=>{
   const changed=await q.query('UPDATE studio_webhook_outbox SET status=$3,next_due=$4,lease_token=NULL,lease_until=0,last_status=$5,last_error=$6 WHERE id=$1 AND lease_token=$2 RETURNING id',[claim.id,lease,state,now+(delays[Math.min(attempt-1,4)]??43200),status,error]);
   if(changed.rows.length)await q.query('INSERT INTO studio_webhook_deliveries(id,outbox_id,attempt,status,error,at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),claim.id,attempt,status,error,now]);
  });
  if(success)delivered++;else failed++;
 }
 return {delivered,failed,configured:true};
}
