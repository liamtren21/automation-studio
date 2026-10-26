import {decodeEventLog,erc20Abi,type Hex} from 'viem';
import {automationVaultAbi} from './automation-abi';
interface ReceiptInput {
 vault:string;recipient:string;executor:string;token:string;policyId:string;version:string;periodIndex:string;amount:string;policyHash:string;nonce:number;expectedData:string;
 tx:{from:string;to:string|null;input:string;value:bigint;nonce:number};
 receipt:{status:string;blockHash:string;logs:readonly{address:string;data:string;topics:readonly unknown[]}[]};canonicalBlockHash:string|null;
}
const same=(a:string|null|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
export function verifyAutomationReceipt(i:ReceiptInput):'confirmed'|'pending'|'reverted' {
 if(!same(i.tx.from,i.executor)||!same(i.tx.to,i.vault)||!same(i.tx.input,i.expectedData)||i.tx.value!==0n||i.tx.nonce!==i.nonce)throw new Error('Transaction does not match the exact automation intent.');
 if(!same(i.receipt.blockHash,i.canonicalBlockHash??''))return 'pending';
 if(i.receipt.status==='reverted')return 'reverted';
 if(i.receipt.status!=='success')return 'pending';
 let eventCount=0,transferCount=0;
 for(const log of i.receipt.logs){
  const topics=log.topics as [Hex,...Hex[]];
  if(same(log.address,i.vault))try{
   const e=decodeEventLog({abi:automationVaultAbi,eventName:'PayoutExecuted',topics,data:log.data as Hex});
   if(same(e.args.policyId,i.policyId)&&e.args.version===BigInt(i.version)&&e.args.periodIndex===BigInt(i.periodIndex)&&same(e.args.recipient,i.recipient)&&e.args.amount===BigInt(i.amount)&&same(e.args.policyHash,i.policyHash))eventCount++;
  }catch{/* Other events cannot prove this payout. */}
  if(same(log.address,i.token))try{
   const e=decodeEventLog({abi:erc20Abi,eventName:'Transfer',topics,data:log.data as Hex});
   if(same(e.args.from,i.vault)&&same(e.args.to,i.recipient)&&e.args.value===BigInt(i.amount))transferCount++;
  }catch{/* Not a matching token transfer. */}
 }
 if(eventCount!==1||transferCount!==1)throw new Error('Receipt lacks one exact payout event and token transfer.');
 return 'confirmed';
}
