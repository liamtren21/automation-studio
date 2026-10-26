import {it,expect,afterEach} from 'vitest';
import {zeroAddress} from 'viem';
import {automationV2DeploymentData} from '../packages/mezo/src/automation-v2-deployment';
import {automationV2Artifact} from '../packages/mezo/src/automation-v2-artifact';
import {expectedV2Runtime} from '../packages/mezo/src/automation-v2-adapter';
import {prepareV2Deployment,verifyV2DeploymentProof,bindV2Deployment,getV2Account} from '../apps/web/src/server/automation/v2-account';
import {createDatabase} from '../packages/db/src/database';
const owner='0x8862e18ac653ac4123dbc0d12528cdbf5402dce8',account='0x3333333333333333333333333333333333333333',hash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
afterEach(()=>{delete process.env.STUDIO_V2_BATCH_DEPLOYMENT;});
function reader(){const data=automationV2DeploymentData(owner,'0.02');return {
 getChainId:async()=>31611,getTransactionReceipt:async()=>({status:'success',contractAddress:account,blockNumber:10n,blockHash}),getTransaction:async()=>({from:owner,to:null,input:data,value:0n}),getBlockNumber:async()=>11n,getBlock:async()=>({hash:blockHash}),getCode:async()=>expectedV2Runtime({account,owner,globalBudget:20000000000000000n}),estimateGas:async()=>100n,
} as any;}
it('builds only the original V2 constructor with a positive exact MUSD budget',()=>{
 expect(automationV2DeploymentData(owner,'0.02')).toMatch(/^0x[0-9a-f]+$/i);
 expect(()=>automationV2DeploymentData(owner,'0')).toThrow();expect(()=>automationV2DeploymentData(zeroAddress,'1')).toThrow();expect(()=>automationV2DeploymentData(owner,'1e2')).toThrow();
});
it('deployment stays disabled until the separate batch gate is enabled',async()=>{
 await expect(prepareV2Deployment(owner,'0.02')).rejects.toThrow(/not enabled/i);
});
it('accepts only exact canonical constructor identity and matching immutable runtime',async()=>{
 process.env.STUDIO_V2_BATCH_DEPLOYMENT='true';const result=await verifyV2DeploymentProof(owner,hash as any,'0.02',reader(),async()=>({blockTimestamp:Math.floor(Date.now()/1000),blockHash,blockNumber:'11'} as any));
 expect(result.address.toLowerCase()).toBe(account);expect(result.globalBudget).toBe('20000000000000000');
});
it('rejects wrong owner, constructor, runtime and insufficient confirmations',async()=>{
 process.env.STUDIO_V2_BATCH_DEPLOYMENT='true';const protocol=async()=>({blockTimestamp:Math.floor(Date.now()/1000)} as any);
 for(const override of [
 {getTransaction:async()=>({from:account,to:null,input:automationV2DeploymentData(owner,'0.02'),value:0n})},
 {getTransaction:async()=>({from:owner,to:null,input:automationV2DeploymentData(owner,'0.03'),value:0n})},
 {getCode:async()=>('0x00')}, {getBlockNumber:async()=>10n},
 ])await expect(verifyV2DeploymentProof(owner,hash as any,'0.02',{...reader(),...override},protocol)).rejects.toThrow();
});
it('binds V2 only to its authenticated owner without replacing V1 or an existing V2 account',async()=>{
 process.env.STUDIO_V2_BATCH_DEPLOYMENT='true';const db=await createDatabase('memory://'),workspace='live:'+owner;
 const protocol=async()=>({blockTimestamp:Math.floor(Date.now()/1000),blockHash,blockNumber:'11'} as any);
 try{
  await db.query('INSERT INTO workspaces(id,mode) VALUES($1,$2)',[workspace,'live']);
  await bindV2Deployment(db,workspace,owner,hash as any,'0.02',reader(),protocol);
  expect((await getV2Account(db,workspace))?.globalBudget).toBe('20000000000000000');
  expect(await getV2Account(db,'live:other')).toBeNull();
  await bindV2Deployment(db,workspace,owner,hash as any,'0.02',reader(),protocol);
  await expect(bindV2Deployment(db,workspace,owner,('0x'+'ef'.repeat(32)) as any,'0.02',reader(),protocol)).rejects.toThrow(/already has another/);
  await expect(bindV2Deployment(db,'live:other',owner,hash as any,'0.02',reader(),protocol)).rejects.toThrow(/owner does not match/);
  expect((await db.query('SELECT * FROM automation_accounts')).rows).toHaveLength(0);
 }finally{await db.close();}
});
