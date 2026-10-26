import {it,expect} from 'vitest';
import {encodeEventTopics,encodeAbiParameters,erc20Abi,keccak256} from 'viem';
import {automationVaultAbi} from '../packages/mezo/src/automation-abi';
import {verifyAutomationReceipt} from '../packages/mezo/src/automation-receipt';
const vault=('0x'+'11'.repeat(20)) as `0x${string}`,recipient=('0x'+'22'.repeat(20)) as `0x${string}`,executor=('0x'+'33'.repeat(20)) as `0x${string}`,token=('0x'+'44'.repeat(20)) as `0x${string}`;
const id=keccak256('0x01'),hash=keccak256('0x02');
const input={vault,recipient,executor,token,policyId:id,version:'1',periodIndex:'0',amount:'5',policyHash:hash,nonce:0,expectedData:'0x1234',tx:{from:executor,to:vault,input:'0x1234',value:0n,nonce:0},receipt:{status:'success',blockHash:hash,logs:[
 {address:vault,topics:encodeEventTopics({abi:automationVaultAbi,eventName:'PayoutExecuted',args:{policyId:id,version:1n,periodIndex:0n}}),data:encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bytes32'}],[recipient,5n,hash])},
 {address:token,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:vault,to:recipient}}),data:encodeAbiParameters([{type:'uint256'}],[5n])},
]},canonicalBlockHash:hash};
it('requires matching transaction, policy event and exact token transfer',()=>{
 expect(verifyAutomationReceipt(input)).toBe('confirmed');
 expect(()=>verifyAutomationReceipt({...input,periodIndex:'1'})).toThrow();
 expect(()=>verifyAutomationReceipt({...input,receipt:{...input.receipt,logs:input.receipt.logs.slice(0,1)}})).toThrow();
 expect(()=>verifyAutomationReceipt({...input,tx:{...input.tx,to:recipient}})).toThrow();
});
it('treats a changed canonical block as unresolved, including reverted receipts',()=>{
 expect(verifyAutomationReceipt({...input,canonicalBlockHash:id})).toBe('pending');
 expect(verifyAutomationReceipt({...input,receipt:{...input.receipt,status:'reverted'}})).toBe('reverted');
 expect(verifyAutomationReceipt({...input,receipt:{...input.receipt,status:'reverted'},canonicalBlockHash:id})).toBe('pending');
});
