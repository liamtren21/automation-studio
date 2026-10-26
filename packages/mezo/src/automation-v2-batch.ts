import {encodeAbiParameters,encodeFunctionData,decodeEventLog,erc20Abi,getAddress,keccak256,toHex,zeroAddress,type Address,type Hex,type PublicClient} from 'viem';
import {buildBatchPolicy,validateBatchDraft,type BatchDraft} from '../../automation/src/studio/batch';
import {automationV2Artifact} from './automation-v2-artifact';
import {officialTestnetMusd} from './network';
import {verifyV2Runtime,type V2Policy,type V2Identity} from './automation-v2-adapter';
import {troveDeployment,troveImplementations} from './trove-read';
const same=(a:string|null|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
export const batchMusdCodeHash='0xc0d0630dacd16463b0390f3914920cb4cbbe3586e7a51ef0d71930249756f474' as const;
/** Kind 0 never calls a loan operation. Loan health cannot enable this batch adapter. */
export async function preflightV2BatchAccount(client:Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'getStorageAt'|'readContract'>,identity:V2Identity,now=Math.floor(Date.now()/1000)){
 if(await client.getChainId()!==31611)throw Error('Wrong group payment chain.');
 const block=await client.getBlock();if(block.timestamp>BigInt(now)||BigInt(now)-block.timestamp>=30n)throw Error('Group network snapshot is stale.');
 const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
 const [code,token,bo,tm,decimals]=await Promise.all([client.getCode({address:identity.account,blockNumber:block.number}),client.getCode({address:officialTestnetMusd,blockNumber:block.number}),client.getStorageAt({address:troveDeployment.borrowerOperations,slot,blockNumber:block.number}),client.getStorageAt({address:troveDeployment.troveManager,slot,blockNumber:block.number}),client.readContract({address:officialTestnetMusd,abi:erc20Abi,functionName:'decimals',blockNumber:block.number})]);
 verifyV2Runtime(identity,code);
 if(!token||keccak256(token)!==batchMusdCodeHash||decimals!==18||!bo||!tm||getAddress('0x'+bo.slice(-40))!==getAddress(troveImplementations.borrowerOperations)||getAddress('0x'+tm.slice(-40))!==getAddress(troveImplementations.troveManager))throw Error('Group token or pinned protocol deployment changed.');
 if((await client.getBlock({blockNumber:block.number})).hash!==block.hash)throw Error('Group network snapshot changed.');
 return {snapshot:{blockNumber:block.number.toString(),blockTimestamp:Number(block.timestamp),blockHash:block.hash},expiresAt:Number(block.timestamp)+30};
}
const tuple={type:'tuple',components:[{name:'id',type:'bytes32'},{name:'version',type:'uint256'},{name:'kind',type:'uint8'},{name:'startAt',type:'uint256'},{name:'endAt',type:'uint256'},{name:'interval',type:'uint256'},{name:'runCap',type:'uint256'},{name:'periodCap',type:'uint256'},{name:'lifetimeCap',type:'uint256'},{name:'enabled',type:'bool'}]} as const;
export function batchConfiguration(workspace:string,draftId:string,account:Address,input:BatchDraft){
 const draft=validateBatchDraft(input),id=keccak256(toHex('AutomationStudio.V2Batch.v1:'+workspace+':'+draftId));
 const built=buildBatchPolicy(draft,{id,account}),policy={...built.policy,enabled:true};
 return {id,policy,payees:built.payees,values:built.values,hash:batchConfigurationHash(account,policy,built.payees,built.values)};
}
export function batchConfigurationHash(account:Address,policy:V2Policy,payees:readonly Address[],values:readonly bigint[]){return keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},tuple,{type:'address[]'},{type:'uint256[]'}],[31611n,account,policy,payees,values]));}
export type BatchConfig=ReturnType<typeof batchConfiguration>;
export function batchExecutionData(id:Hex,version:string,period:string){return encodeFunctionData({abi:automationV2Artifact.abi,functionName:'execute',args:[id,BigInt(version),BigInt(period),zeroAddress,zeroAddress]});}
export function verifyBatchReceipt(i:{config:BatchConfig;account:Address;executor:Address;period:string;nonce:number;tx:{from:string;to:string|null;value:bigint;nonce:number;input:string};receipt:{status:string;blockHash:string;logs:readonly {address:string;topics:readonly unknown[];data:string}[]};canonicalBlockHash:string|null}):'confirmed'|'pending'|'reverted'{
 if(!same(i.tx.from,i.executor)||!same(i.tx.to,i.account)||i.tx.value!==0n||i.tx.nonce!==i.nonce||!same(i.tx.input,batchExecutionData(i.config.id,i.config.policy.version.toString(),i.period)))throw Error('Transaction does not match this exact group payment.');
 if(!same(i.receipt.blockHash,i.canonicalBlockHash??''))return 'pending';
 if(i.receipt.status==='reverted')return 'reverted';if(i.receipt.status!=='success')return 'pending';
 let events=0,outgoing=0;const counts=i.config.payees.map(()=>0),total=i.config.values.reduce((a,b)=>a+b,0n);
 for(const log of i.receipt.logs){
  if(same(log.address,i.account))try{const e=decodeEventLog({abi:automationV2Artifact.abi,eventName:'Executed',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(same(e.args.id,i.config.id)&&e.args.version===i.config.policy.version&&e.args.period===BigInt(i.period)&&e.args.amount===total&&e.args.kind===0)events++;}catch{}
  if(same(log.address,officialTestnetMusd))try{const e=decodeEventLog({abi:erc20Abi,eventName:'Transfer',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(same(e.args.from,i.account)){outgoing++;const index=i.config.payees.findIndex((a,j)=>same(e.args.to,a)&&e.args.value===i.config.values[j]);if(index>=0)counts[index]++;}}catch{}
 }
 if(events!==1||outgoing!==i.config.payees.length||counts.some(n=>n!==1))throw Error('Receipt does not prove every group recipient received the exact approved amount.');
 return 'confirmed';
}
