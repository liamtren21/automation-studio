export interface Env {STUDIO_TICK_URL:string;STUDIO_SCHEDULER_SECRET:string}
async function tick(env:Env){const r=await fetch(env.STUDIO_TICK_URL,{method:'POST',headers:{authorization:'Bearer '+env.STUDIO_SCHEDULER_SECRET},signal:AbortSignal.timeout(55000)});if(!r.ok)throw new Error('Studio tick status '+r.status);return r;}
export default{
 async scheduled(_event:unknown,env:Env,ctx:{waitUntil(p:Promise<unknown>):void}){ctx.waitUntil(tick(env));},
 async fetch(request:Request,env:Env){if(request.method!=='POST'||request.headers.get('authorization')!=='Bearer '+env.STUDIO_SCHEDULER_SECRET)return new Response('Not found',{status:404});return tick(env);}
};
