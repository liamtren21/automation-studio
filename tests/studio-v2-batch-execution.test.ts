import {it,expect} from 'vitest';
import {encodeEventTopics,encodeAbiParameters,erc20Abi,keccak256,zeroAddress} from 'viem';
import {createBatchDraft,buildBatchPolicy} from '../packages/automation/src/studio/batch';
import {batchConfiguration,verifyBatchReceipt,batchExecutionData} from '../packages/mezo/src/automation-v2-batch';
import {automationV2Artifact} from '../packages/mezo/src/automation-v2-artifact';
import {officialTestnetMusd} from '../packages/mezo/src/network';
const owner='0x8862e18ac653ac4123dbc0d12528cdbf5402dce8',account='0x52DD91F102682075E1Fe2D232558366d014Eae5A',other='0x710fb8a1f10feca1d9603de4855b5b04943bb1d0',executor='0x8916e1C6f9C187c9BBf1870b92C85dB2a398e7C2';
const draft=createBatchDraft({name:'Test',recipients:[{address:owner,amount:'0.01'},{address:other,amount:'0.01'}],schedule:{kind:'once',startAt:'100',endAt:'86500'},lifetimeBudget:'0.02'});
const config=batchConfiguration('live:'+owner,'test-draft',account,draft),hash=('0x'+'aa'.repeat(32)) as `0x${string}`;
it('uses deterministic identity and exact aggregate enabled owner configuration',()=>{
 expect(batchConfiguration('live:'+owner,'test-draft',account,draft).hash).toBe(config.hash);
 expect(config.policy.enabled).toBe(true);expect(config.policy.kind).toBe(0);expect(config.policy.runCap).toBe(20000000000000000n);
 expect(config.id).not.toBe(batchConfiguration('live:'+owner,'other',account,draft).id);
 expect(()=>batchConfiguration('live:'+owner,'test-draft',owner,draft)).toThrow();
});
function proof(){const execute=automationV2Artifact.abi.find(e=>e.type==='event'&&e.name==='Executed')!;
 const executed={address:account,topics:encodeEventTopics({abi:[execute] as never,eventName:'Executed'} as never),data:encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint8'}],[config.id,1n,0n,20000000000000000n,0])};
 // Executed indexes id; its other fields are encoded in data.
 executed.topics=[keccak256(new TextEncoder().encode('Executed(bytes32,uint256,uint256,uint256,uint8)')),config.id] as never;
 executed.data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint8'}],[1n,0n,20000000000000000n,0]);
 return {config,account,executor,period:'0',nonce:1,tx:{from:executor,to:account,value:0n,nonce:1,input:batchExecutionData(config.id,'1','0')},receipt:{status:'success',blockHash:hash,logs:[...config.payees.map((to,i)=>({address:officialTestnetMusd,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:account,to}}),data:encodeAbiParameters([{type:'uint256'}],[config.values[i]!])})),executed]},canonicalBlockHash:hash};}
it('requires the exact batch call plus all recipient transfers and execution event',()=>{
 const p=proof();expect(verifyBatchReceipt(p as never)).toBe('confirmed');
 for(const change of [{tx:{...p.tx,from:owner}},{tx:{...p.tx,input:batchExecutionData(config.id,'1','1')}},{receipt:{...p.receipt,logs:p.receipt.logs.slice(1)}},{receipt:{...p.receipt,logs:[...p.receipt.logs,p.receipt.logs[0]!]}}])expect(()=>verifyBatchReceipt({...p,...change} as never)).toThrow();
 expect(verifyBatchReceipt({...p,canonicalBlockHash:'0x'+'bb'.repeat(32)} as never)).toBe('pending');
 expect(verifyBatchReceipt({...p,receipt:{...p.receipt,status:'reverted'}} as never)).toBe('reverted');
});
