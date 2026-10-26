import {createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({jar:new Map<string,string>(),query:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(key:string)=>mocks.jar.has(key)?{value:mocks.jar.get(key)}:undefined,set:(key:string,value:string)=>mocks.jar.set(key,value)})}));
vi.mock('../packages/db/src/database',()=>({database:async()=>({query:mocks.query})}));
import {sessionAddress,workspaceIdentity} from '../apps/web/src/server/auth';
import {allowedOrigins} from '../apps/web/src/server/origin';
beforeEach(()=>{mocks.jar.clear();mocks.query.mockReset();vi.stubEnv('STUDIO_ORIGIN','');vi.stubEnv('MEZORA_ORIGIN','https://mezora.example');vi.stubEnv('VERCEL_URL','');vi.stubEnv('VERCEL_BRANCH_URL','');vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL','');});
afterEach(()=>vi.unstubAllEnvs());
it('ignores Mezora session, demo and selected workspace cookies',async()=>{
 mocks.jar.set('mezora-session','old');mocks.jar.set('mezora-demo','a'.repeat(48));mocks.jar.set('mezora-workspace','live:0x'+'22'.repeat(20));
 expect(await sessionAddress()).toBeNull();expect(mocks.query).not.toHaveBeenCalled();
 const demo=await workspaceIdentity('demo');expect(demo.id).toMatch(/^demo:[a-f0-9]{48}$/);expect(demo.id).not.toBe('demo:'+'a'.repeat(48));expect(mocks.jar.has('studio-demo')).toBe(true);
 await expect(workspaceIdentity('live')).rejects.toThrow(/sign in/);
});
it('uses only the authenticated wallet as owner even when another workspace is selected',async()=>{
 const owner='0x'+'11'.repeat(20);mocks.jar.set('studio-session','token');mocks.jar.set('mezora-workspace','live:0x'+'22'.repeat(20));mocks.query.mockResolvedValue({rows:[{address:owner}]});
 expect(await workspaceIdentity('live')).toEqual({id:'live:'+owner,owner,actor:owner,role:'owner'});
 expect(mocks.query).toHaveBeenCalledTimes(1);expect(mocks.query.mock.calls[0][1][0]).toBe(createHash('sha256').update('token').digest('hex'));
});
it('defaults to the independent local port and never inherits Mezora origin',()=>{
 expect(allowedOrigins()).toEqual(['http://localhost:3211']);vi.stubEnv('STUDIO_ORIGIN','https://studio.example/app');expect(allowedOrigins()).toEqual(['https://studio.example']);
});
