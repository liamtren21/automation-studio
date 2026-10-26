import {it,expect} from 'vitest';
import {decodeFunctionData,padHex} from 'viem';
import {createBatchDraft} from '../packages/automation/src/studio/batch';
import {groupSetupTransaction,type GroupReview} from '../packages/mezo/src/automation-v2-setup';
import {automationV2Artifact} from '../packages/mezo/src/automation-v2-artifact';
import {preflightV2BatchAccount} from '../packages/mezo/src/automation-v2-batch';
import {expectedV2Runtime} from '../packages/mezo/src/automation-v2-adapter';
import {troveImplementations} from '../packages/mezo/src/trove-read';
const owner='0x8862e18ac653ac4123dbc0d12528cdbf5402dce8',account='0x52DD91F102682075E1Fe2D232558366d014Eae5A';
const draft=createBatchDraft({name:'Two wallets',recipients:[{address:owner,amount:'0.01'},{address:'0x710fb8a1f10feca1d9603de4855b5b04943bb1d0',amount:'0.01'}],schedule:{kind:'once',startAt:'100',endAt:'86500'},lifetimeBudget:'0.02'});
const review:GroupReview={step:'configure',owner,account,draftId:'d',globalBudget:'20000000000000000'};
it('owner approval binds the exact complete recipient list and aggregate caps',()=>{
 const tx=groupSetupTransaction(review,draft),decoded=decodeFunctionData({abi:automationV2Artifact.abi,data:tx.data});
 expect(decoded.functionName).toBe('configure');if(decoded.functionName!=='configure')throw Error('configure required');
 expect(decoded.args[0].kind).toBe(0);expect(decoded.args[0].enabled).toBe(true);expect(decoded.args[0].lifetimeCap).toBe(20000000000000000n);
 expect(decoded.args[1].map(a=>a.toLowerCase())).toEqual(draft.recipients.map(r=>r.address.toLowerCase()));expect(decoded.args[2]).toEqual([10000000000000000n,10000000000000000n]);
});
it('setup cannot smuggle a loan action, a token allowance or a larger allocation',()=>{
 expect(()=>groupSetupTransaction({...review,step:'openLoan'} as never,draft)).toThrow();
 expect(()=>groupSetupTransaction({...review,step:'allocate',amount:'20000000000000001'},draft)).toThrow();
 const tx=groupSetupTransaction({...review,step:'classify',amount:'20000000000000000'},draft);
 expect(decodeFunctionData({abi:automationV2Artifact.abi,data:tx.data}).functionName).toBe('classifyCapital');expect(tx.to).toBe(account);
});
it('batch preflight rejects wrong chains and a changed MUSD implementation',async()=>{
 await expect(preflightV2BatchAccount({getChainId:async()=>1} as never,{owner,account,globalBudget:20000000000000000n})).rejects.toThrow(/chain/i);
 const now=Math.floor(Date.now()/1000),identity={owner,account,globalBudget:20000000000000000n} as const;
 const reader={getChainId:async()=>31611,getBlock:async()=>({timestamp:BigInt(now),number:1n,hash:'0x'+'12'.repeat(32)}),getCode:async({address}:{address:string})=>address.toLowerCase()===account.toLowerCase()?expectedV2Runtime(identity):'0x00',getStorageAt:async({address}:{address:string})=>padHex(address.toLowerCase().startsWith('0xcdf')?troveImplementations.borrowerOperations:troveImplementations.troveManager,{size:32}),readContract:async()=>18};
 await expect(preflightV2BatchAccount(reader as never,identity)).rejects.toThrow(/token|deployment/i);
});
