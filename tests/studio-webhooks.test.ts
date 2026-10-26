import {afterEach,expect,it,vi} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {assertPublicWebhookUrl,postWebhook,protectWebhookSecret,unprotectWebhookSecret,webhookSignature,verifyWebhookSignature} from '../apps/web/src/server/automation/webhooks';
import {EventEmitter} from 'node:events';
import type https from 'node:https';
import {createWebhookEndpoint,enqueueRunWebhook} from '../packages/db/src/webhooks';
import {deliverWebhookBatch} from '../apps/worker/src/automation/webhook-delivery';
import {createAutomationPolicy,claimAutomationRun,updateAutomationRun} from '../packages/db/src/automation';
import {keccak256} from 'viem';
const key='11'.repeat(32);
it('protects secrets and binds timestamp/raw payload for signatures with a replay window',()=>{
 const encrypted=protectWebhookSecret('secret',key);expect(encrypted).not.toContain('secret');expect(unprotectWebhookSecret(encrypted,key)).toBe('secret');
 const sig=webhookSignature('secret','1000','{"id":"one"}');expect(verifyWebhookSignature('secret','1000','{"id":"one"}',sig,1000)).toBe(true);
 expect(verifyWebhookSignature('secret','1000','{}',sig,1000)).toBe(false);expect(verifyWebhookSignature('secret','1000','{"id":"one"}',sig,2000)).toBe(false);
 expect(()=>unprotectWebhookSecret(encrypted,'22'.repeat(32))).toThrow();
});
it('refuses credentials, local/private/metadata IPv4 and IPv6, redirects and mixed DNS targets',async()=>{
 for(const url of ['http://public.test','https://user:pw@public.test','https://127.0.0.1','https://[::1]','https://169.254.169.254','https://localhost'])await expect(assertPublicWebhookUrl(url,async()=>[{address:'127.0.0.1',family:4}])).rejects.toThrow();
 await expect(assertPublicWebhookUrl('https://public.test',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}])).rejects.toThrow();
 expect((await assertPublicWebhookUrl('https://public.test/hook',async()=>[{address:'8.8.8.8',family:4}])).target.address).toBe('8.8.8.8');
});
it('pins DNS at the actual connection and does not follow a redirect response',async()=>{
 let calls=0,resolves=0;
 const request=((_url:unknown,options:{lookup:Function},callback:Function)=>{calls++;options.lookup('public.test',{all:true},(error:unknown,addresses:unknown)=>{expect(error).toBeNull();expect(addresses).toEqual([{address:'8.8.8.8',family:4}]);});const req=new EventEmitter() as EventEmitter&{setTimeout:Function;end:Function};req.setTimeout=()=>req;req.end=()=>{queueMicrotask(()=>callback({statusCode:302,destroy:()=>{}}));};return req;}) as unknown as typeof https.request;
 const out=await postWebhook('https://public.test/hook','{}',{}, {resolver:async()=>{resolves++;return [{address:resolves===1?'8.8.8.8':'127.0.0.1',family:4}];},request});
 expect(out.status).toBe(302);expect(calls).toBe(1);expect(resolves).toBe(1);
});
it('enforces an absolute deadline even when a peer never triggers socket inactivity',async()=>{
 vi.useFakeTimers();
 try{
  let destroyed=false;
  const request=(()=>{const req=new EventEmitter() as EventEmitter&{setTimeout:Function;end:Function;destroy:Function};req.setTimeout=()=>req;req.end=()=>{};req.destroy=()=>{destroyed=true;};return req;}) as unknown as typeof https.request;
  const sent=postWebhook('https://public.test','{}',{}, {resolver:async()=>[{address:'8.8.8.8',family:4}],request});
  const assertion=expect(sent).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(8001);await assertion;expect(destroyed).toBe(true);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
const dbs:Database[]=[];afterEach(async()=>{for(const d of dbs.splice(0))await d.close();});
it('dedupes events and retries only delivery after failure, without re-running payments',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:w','live')");
 const endpoint=await createWebhookEndpoint(db,'live:w','https://public.test/hook',protectWebhookSecret('secret',key));
 const event={runId:'run-1',transitionVersion:1,type:'payment.confirmed' as const,data:{amount:'5',recipient:'0x2222222222222222222222222222222222222222'}};
 await db.transaction(async q=>{await enqueueRunWebhook(q,'live:w',event,1000);await enqueueRunWebhook(q,'live:w',event,1000);});
 expect((await db.query('SELECT id FROM studio_webhook_outbox')).rows).toHaveLength(1);
 let calls=0;const transport=async(_url:string,body:string,headers:Record<string,string>)=>{calls++;expect(verifyWebhookSignature('secret',headers['x-studio-timestamp']!,body,headers['x-studio-signature']!,1000)).toBe(true);return {status:500};};
 await deliverWebhookBatch(db,{now:1000,key,transport});await deliverWebhookBatch(db,{now:1001,key,transport});expect(calls).toBe(1);
 await deliverWebhookBatch(db,{now:1060,key,transport:async()=>({status:200})});
 expect((await db.query<{status:string}>('SELECT status FROM studio_webhook_outbox')).rows[0]!.status).toBe('delivered');
 expect((await db.query('SELECT id FROM automation_runs')).rows).toHaveLength(0);
 expect(endpoint.id).toBeTruthy();
},20000);
it('emits one blocked episode through repeated lease retries of the same payment',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:w','live')");
 await createWebhookEndpoint(db,'live:w','https://public.test/hook',protectWebhookSecret('secret',key));
 const policy={chainId:'31611',vault:'0x1111111111111111111111111111111111111111' as const,policyId:keccak256('0x01'),version:'1',recipient:'0x2222222222222222222222222222222222222222' as const,amount:'5',startAt:'100',endAt:'10000',intervalSeconds:'1000',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'50',priority:'1',enabled:true};
 await createAutomationPolicy(db,'live:w',policy);
 const claimInput={workspaceId:'live:w',chainId:'31611',vault:policy.vault,policyId:policy.policyId,version:'1',periodIndex:'0',workerId:'worker',leaseSeconds:'60'};
 const claim=await claimAutomationRun(db,{...claimInput,now:'100'});await updateAutomationRun(db,claim!,{state:'blocked',body:{reason:'GAS_LOW'}},'101');
 const retry=await claimAutomationRun(db,{...claimInput,now:'200'});await updateAutomationRun(db,retry!,{state:'blocked',body:{reason:'GAS_LOW'}},'201');
 expect((await db.query('SELECT id FROM studio_webhook_outbox')).rows).toHaveLength(1);
 const changed=await claimAutomationRun(db,{...claimInput,now:'300'});await updateAutomationRun(db,changed!,{state:'blocked',body:{reason:'PROTECTION_STALE'}},'301');
 expect((await db.query('SELECT id FROM studio_webhook_outbox')).rows).toHaveLength(2);
},20000);
