import {expect,it} from 'vitest';
import {executorConfiguration,readRuntimeHealth} from '../apps/web/src/server/automation/runtime-health';
const address='0x1111111111111111111111111111111111111111';
it('never verifies a public executor address without the matching restricted signer',()=>{
 const key=('0x'+'11'.repeat(32)) as `0x${string}`;
 expect(executorConfiguration(address,undefined).identityVerified).toBe(false);
 expect(executorConfiguration(address,key).identityVerified).toBe(false);
 expect(executorConfiguration(undefined,key).identityVerified).toBe(true);
 expect(executorConfiguration(executorConfiguration(undefined,key).address,key).identityVerified).toBe(true);
});
it('pins executor access and gas to one block and never marks failed reads ready',async()=>{
 const seen:bigint[]=[];
 const reader={readContract:async(i:{blockNumber:bigint})=>{seen.push(i.blockNumber);return true;},getBalance:async(i:{blockNumber:bigint})=>{seen.push(i.blockNumber);return 10n;}};
 expect(await readRuntimeHealth(address,123n,reader,{address,enabled:true})).toMatchObject({executorAddress:address,authorized:true,gasBalance:'10',executionEnabled:true,blockNumber:'123',status:'checked',checkedAt:expect.any(String)});
 expect(seen).toEqual([123n,123n]);
 const unavailable=await readRuntimeHealth(address,123n,{...reader,getBalance:async()=>{throw Error('secret rpc URL');}},{address,enabled:true});
 expect(unavailable.status).toBe('unknown');expect(unavailable.authorized).toBeNull();expect(JSON.stringify(unavailable)).not.toContain('secret');
});
it('distinguishes disabled execution from missing executor and does not call RPC without an address',async()=>{
 const reader={readContract:async()=>{throw Error('must not read');},getBalance:async()=>{throw Error('must not read');}};
 const result=await readRuntimeHealth(address,1n,reader,{enabled:false});
 expect(result).toMatchObject({executorAddress:null,authorized:null,gasBalance:null,executionEnabled:false,status:'unconfigured'});
});
