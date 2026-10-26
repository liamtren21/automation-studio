import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {database} from '../../../../../../../packages/db/src/database';
import {createWebhookEndpoint} from '../../../../../../../packages/db/src/webhooks';
import {workspaceIdentity} from '@/server/auth';
import {readBody,errorResponse} from '@/server/http';
import {assertPublicWebhookUrl,protectWebhookSecret} from '@/server/automation/webhooks';
import {rateLimit} from '@/server/automation/rate-limit';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function listing(){const identity=await workspaceIdentity('live'),db=await database();
 const endpoints=(await db.query('SELECT id,url,enabled,revision FROM studio_webhook_endpoints WHERE workspace_id=$1 ORDER BY created_at',[identity.id])).rows;
 const deliveries=(await db.query('SELECT o.id,o.event_id AS "eventId",o.endpoint_id AS "endpointId",o.status,o.attempts,o.last_status AS "lastStatus",o.last_error AS "lastError",o.next_due::text AS "nextDue" FROM studio_webhook_outbox o WHERE workspace_id=$1 ORDER BY next_due DESC LIMIT 50',[identity.id])).rows;
 return {configured:/^[0-9a-f]{64}$/i.test(process.env.STUDIO_WEBHOOK_ENCRYPTION_KEY??''),endpoints,deliveries};}
export async function GET(){try{return NextResponse.json(await listing(),{headers});}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{
 const b=await readBody(req),identity=await workspaceIdentity('live'),db=await database();await rateLimit(db,'webhooks:'+identity.id,20);
 const id=typeof b.id==='string'?b.id:'';
 if(b.action==='create'||b.action==='rotate'){
  const key=process.env.STUDIO_WEBHOOK_ENCRYPTION_KEY??'';if(!/^[0-9a-f]{64}$/i.test(key))throw new Error('Webhook delivery is not configured on this host.');
  if(b.consent!==true)throw new Error('Confirm sending payment notifications to this endpoint.');
  const secret=randomBytes(32).toString('hex'),encrypted=protectWebhookSecret(secret,key);
  if(b.action==='create'){if(typeof b.url!=='string')throw new Error('Enter an HTTPS endpoint.');await assertPublicWebhookUrl(b.url);const endpoint=await createWebhookEndpoint(db,identity.id,b.url,encrypted);return NextResponse.json({...await listing(),created:endpoint,secret},{headers});}
  const changed=await db.query('UPDATE studio_webhook_endpoints SET secret_encrypted=$3,revision=revision+1 WHERE id=$1 AND workspace_id=$2 RETURNING id',[id,identity.id,encrypted]);if(!changed.rows.length)throw new Error('Endpoint not found.');return NextResponse.json({...await listing(),secret},{headers});
 }
 if(b.action==='toggle'){if(typeof b.enabled!=='boolean')throw new Error('Choose enable or disable.');const out=await db.query('UPDATE studio_webhook_endpoints SET enabled=$3,revision=revision+1 WHERE id=$1 AND workspace_id=$2 RETURNING id',[id,identity.id,b.enabled]);if(!out.rows.length)throw new Error('Endpoint not found.');}
 else if(b.action==='retry'){const out=await db.query("UPDATE studio_webhook_outbox SET status='pending',attempts=0,next_due=$3,lease_until=0,lease_token=NULL WHERE id=$1 AND workspace_id=$2 AND status='failed' RETURNING id",[id,identity.id,Math.floor(Date.now()/1000)]);if(!out.rows.length)throw new Error('Failed notification not found.');}
 else throw new Error('Unknown webhook action.');
 return NextResponse.json(await listing(),{headers});
 }catch(error){return errorResponse(error);}}
