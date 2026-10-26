import {monitorTick} from './automation/monitor';
import {database} from '../../../packages/db/src/database';
import {automationTick} from './automation/runtime';
import {batchAutomationTick} from './automation/batch-runtime';
import {randomUUID} from 'node:crypto';
import {deliverWebhookBatch} from './automation/webhook-delivery';
if(!process.env.DATABASE_URL?.startsWith('postgres'))throw new Error('The Automation Studio worker requires its dedicated PostgreSQL DATABASE_URL.');
const db=await database();let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
const workerId='automation:'+randomUUID();
while(!stopping){
 try{await monitorTick(db,{limit:2,workerId});}catch{console.error('Read-only monitor tick failed');}
 try{await automationTick(db,workerId);}catch(error){console.error('Automation worker stopped this tick',error instanceof Error?error.message:'Unknown worker error');}
 try{await batchAutomationTick(db,workerId);}catch(error){console.error('Group payment tick needs review',error instanceof Error?error.name:'ExecutionUnavailable');}
 try{await deliverWebhookBatch(db,{limit:2});}catch{console.error('Webhook delivery tick failed');}
 await new Promise(resolve=>setTimeout(resolve,10000));
}await db.close();
