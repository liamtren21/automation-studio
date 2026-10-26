import {encodeDeployData,encodeFunctionData,erc20Abi,getAddress,type Address,type Hex} from 'viem';
import {hashPolicy,integer,type StudioPolicy} from '../../automation/src/studio';
import {parseMusd} from '../../domain/src/money';
import {automationVaultAbi} from './automation-abi';
import build from './automation-build.json';
import {officialTestnetMusd} from './network';
export type StudioOperation='configure'|'allocate'|'release'|'revoke'|'protection'|'executor'|'pause'|'unpause'|'deposit'|'withdraw';
export interface StudioOperationInput {operation:StudioOperation;vault:Address;owner:Address;policy?:StudioPolicy;policyId?:Hex;amount?:string;executor?:Address;allowed?:boolean;sourceHash?:Hex;committedBills?:string;buffer?:string;expiresAt?:string}
export function automationDeploymentData(owner:Address,budget:string,token:Address=officialTestnetMusd) {
 const units=parseMusd(budget);if(units===0n)throw new Error('A positive lifetime automation budget is required.');
 return encodeDeployData({abi:automationVaultAbi,bytecode:build.bytecode as Hex,args:[token,getAddress(owner),units]});
}
export function policyTuple(policy:StudioPolicy){hashPolicy(policy);return {...policy,chainId:integer(policy.chainId),version:integer(policy.version),amount:integer(policy.amount),startAt:integer(policy.startAt),endAt:integer(policy.endAt),intervalSeconds:integer(policy.intervalSeconds),perRunCap:integer(policy.perRunCap),perPeriodCap:integer(policy.perPeriodCap),lifetimeCap:integer(policy.lifetimeCap),priority:integer(policy.priority)};}
export function automationOperationData(i:StudioOperationInput):{to:Address;data:Hex;value:'0x0';chainId:31611} {
 const amount=()=>{const n=parseMusd(i.amount??'');if(n===0n)throw new Error('Amount must be positive.');return n;};
 const id=()=>{if(!i.policyId||!/^0x[0-9a-f]{64}$/i.test(i.policyId))throw new Error('Policy required.');return i.policyId;};
 let data:Hex,to=i.vault;
 switch(i.operation){
  case 'configure':if(!i.policy||i.policy.vault.toLowerCase()!==i.vault.toLowerCase())throw new Error('Policy vault changed.');data=encodeFunctionData({abi:automationVaultAbi,functionName:'configurePolicy',args:[policyTuple(i.policy)]});break;
  case 'allocate':case 'release':data=encodeFunctionData({abi:automationVaultAbi,functionName:i.operation,args:[id(),amount()]});break;
  case 'revoke':data=encodeFunctionData({abi:automationVaultAbi,functionName:'revokePolicy',args:[id()]});break;
  case 'protection':if(!i.sourceHash||!i.expiresAt||i.committedBills===undefined||i.buffer===undefined)throw new Error('Protection review required.');data=encodeFunctionData({abi:automationVaultAbi,functionName:'setProtection',args:[integer(i.committedBills),integer(i.buffer),i.sourceHash,integer(i.expiresAt)]});break;
  case 'executor':if(!i.executor||typeof i.allowed!=='boolean')throw new Error('Executor review required.');data=encodeFunctionData({abi:automationVaultAbi,functionName:'setExecutor',args:[getAddress(i.executor),i.allowed]});break;
  case 'pause':case 'unpause':data=encodeFunctionData({abi:automationVaultAbi,functionName:i.operation});break;
  case 'deposit':to=officialTestnetMusd;data=encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[i.vault,amount()]});break;
  case 'withdraw':data=encodeFunctionData({abi:automationVaultAbi,functionName:'withdrawUnallocated',args:[i.owner,amount()]});break;
  default:throw new Error('Unsupported automation operation.');
 }
 return {to,data,value:'0x0',chainId:31611};
}
