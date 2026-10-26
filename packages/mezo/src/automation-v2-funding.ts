import {encodeFunctionData,decodeEventLog,erc20Abi,isAddress,zeroAddress,type Address,type Hex} from 'viem';
import {officialTestnetMusd} from './network';
const same=(a:string|null|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
export function groupFundingData(account:string,amount:string):Hex{
 if(!isAddress(account)||same(account,zeroAddress)||!/^\d{1,78}$/.test(amount)||BigInt(amount)<=0n||BigInt(amount)>=2n**256n)throw Error('Invalid group payment deposit.');
 return encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[account,BigInt(amount)]});
}
export function verifyGroupFundingReceipt(i:{owner:Address;account:Address;amount:string;tx:{from:string;to:string|null;input:string;value:bigint};receipt:{status:string;blockHash:string;logs:readonly {address:string;topics:readonly unknown[];data:string}[]};canonicalBlockHash:string|null}){
 if(!same(i.tx.from,i.owner)||!same(i.tx.to,officialTestnetMusd)||!same(i.tx.input,groupFundingData(i.account,i.amount))||i.tx.value!==0n)throw Error('Deposit does not match the reviewed owner, account and amount.');
 if(i.receipt.status!=='success')throw Error('Transaction reverted. No group payment deposit confirmed.');
 if(!same(i.receipt.blockHash,i.canonicalBlockHash??''))throw Error('Deposit confirmation is pending.');
 let transfers=0;
 for(const log of i.receipt.logs)if(same(log.address,officialTestnetMusd))try{const e=decodeEventLog({abi:erc20Abi,eventName:'Transfer',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(same(e.args.from,i.owner)&&same(e.args.to,i.account)&&e.args.value===BigInt(i.amount))transfers++;}catch{}
 if(transfers!==1)throw Error('Deposit receipt does not match the reviewed token transfer.');
 return true;
}
