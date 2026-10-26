import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {authorizedScheduler} from '@/server/automation/scheduler-auth';
import {automationTick} from '../../../../../../worker/src/automation/runtime';
import {batchAutomationTick} from '../../../../../../worker/src/automation/batch-runtime';
import {monitorTick} from '../../../../../../worker/src/automation/monitor';
import {deliverWebhookBatch} from '../../../../../../worker/src/automation/webhook-delivery';
import {executorConfiguration} from '@/server/automation/runtime-health';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:NextRequest){
 if(!authorizedScheduler(request.headers.get('authorization'),process.env.STUDIO_SCHEDULER_SECRET))return NextResponse.json({error:'Unauthorized scheduler'},{status:401,headers:{'Cache-Control':'no-store'}});
 const db=await database(),started=Math.floor(Date.now()/1000);
 try{
  const result=await db.transaction(async lock=>{
   const got=await lock.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(78134132) AS locked');if(!got.rows[0]?.locked)return{skipped:true};
   await db.query("UPDATE studio_scheduler SET last_started=$1,status='running' WHERE id='main'",[started]);
   const monitoring=await monitorTick(db,{limit:2,workerId:'hosted:'+started});
   await automationTick(db,'hosted:'+started);
   const groupPayments=await batchAutomationTick(db,'hosted:'+started);
   const webhooks=await deliverWebhookBatch(db,{limit:1});
   const body={monitoring,webhooks,groupPayments,executionEnabled:process.env.STUDIO_AUTOMATION_EXECUTION==='true',executor:executorConfiguration(process.env.STUDIO_EXECUTOR_ADDRESS,process.env.STUDIO_EXECUTOR_PRIVATE_KEY).address??null};
   await db.query("UPDATE studio_scheduler SET last_finished=$1,status='ok',body=$2::jsonb WHERE id='main'",[Math.floor(Date.now()/1000),JSON.stringify(body)]);
   return{ok:true,...body};
  });return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){await db.query("UPDATE studio_scheduler SET last_finished=$1,status='error',body=$2::jsonb WHERE id='main'",[Math.floor(Date.now()/1000),JSON.stringify({error:e instanceof Error?e.name:'RuntimeError'})]);return NextResponse.json({error:'Runtime tick failed; inspect authenticated runtime status.'},{status:503});}
}
