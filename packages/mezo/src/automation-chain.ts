import {erc20Abi,keccak256,type Address,type Hex} from 'viem';
import {publicClient,officialTestnetMusd} from './network';
import {automationVaultAbi} from './automation-abi';
import build from './automation-build.json';
import {periodAt,type StudioPolicy,type StudioSnapshot} from '../../automation/src/studio';
export {automationDeploymentData} from './automation-payload';

export function matchesAutomationRuntime(runtime:string) {
 if(!/^0x[0-9a-f]+$/i.test(runtime)||runtime.length!==build.deployedBytecode.length)return false;
 const refs=Object.values(build.immutableReferences).flat() as {start:number;length:number}[];
 for(const group of Object.values(build.immutableReferences) as {start:number;length:number}[][]){const first=runtime.slice(2+group[0].start*2,2+(group[0].start+group[0].length)*2).toLowerCase();if(group.some(r=>runtime.slice(2+r.start*2,2+(r.start+r.length)*2).toLowerCase()!==first))return false;}
 const mask=(input:string)=>{let s=input.toLowerCase();for(const r of refs)s=s.slice(0,2+r.start*2)+'0'.repeat(r.length*2)+s.slice(2+(r.start+r.length)*2);return s;};
 return mask(runtime)===mask(build.deployedBytecode);
}
export async function readAutomationVault(vault:Address,owner:Address,atBlockNumber?:bigint) {
 const p=publicClient();if(await p.getChainId()!==31611)throw new Error('Automation RPC returned the wrong chain.');
 const block=await p.getBlock(atBlockNumber===undefined?{}:{blockNumber:atBlockNumber});const blockNumber=block.number;
 const read=<N extends 'owner'|'token'|'globalBudget'|'globalSpent'|'committedBills'|'buffer'|'protectionSourceHash'|'protectionExpiresAt'|'totalAllocated'|'paused'>(name:N)=>p.readContract({address:vault,abi:automationVaultAbi,functionName:name,blockNumber});
 const [code,actualOwner,token,globalBudget,globalSpent,committedBills,buffer,sourceHash,expires,totalAllocated,paused,balance,decimals]=await Promise.all([
  p.getCode({address:vault,blockNumber}),read('owner'),read('token'),read('globalBudget'),read('globalSpent'),read('committedBills'),read('buffer'),read('protectionSourceHash'),read('protectionExpiresAt'),read('totalAllocated'),read('paused'),
  p.readContract({address:officialTestnetMusd,abi:erc20Abi,functionName:'balanceOf',args:[vault],blockNumber}),p.readContract({address:officialTestnetMusd,abi:erc20Abi,functionName:'decimals',blockNumber}),
 ]);
 if(!code||!matchesAutomationRuntime(code)||actualOwner.toLowerCase()!==owner.toLowerCase()||token.toLowerCase()!==officialTestnetMusd.toLowerCase()||decimals!==18)throw new Error('Automation vault build, owner or token does not match.');
 if((await p.getBlock({blockNumber})).hash!==block.hash)throw new Error('Automation snapshot changed. Refresh before acting.');
 return {vault,owner,token,block,codeHash:keccak256(code),globalBudget:globalBudget.toString(),globalSpent:globalSpent.toString(),committedBills:committedBills.toString(),buffer:buffer.toString(),sourceHash,expires:expires.toString(),totalAllocated:totalAllocated.toString(),paused,balance:balance.toString()};
}
export async function readAutomationPolicy(policy:StudioPolicy,owner:Address,currentSourceHash:Hex,executor?:Address,atBlockNumber?:bigint) {
 const vault=await readAutomationVault(policy.vault,owner,atBlockNumber),p=publicClient(),blockNumber=vault.block.number;
 const [actual,allocation,lifetimeSpent]=await Promise.all([
  p.readContract({address:policy.vault,abi:automationVaultAbi,functionName:'policyOf',args:[policy.policyId],blockNumber}),
  p.readContract({address:policy.vault,abi:automationVaultAbi,functionName:'allocation',args:[policy.policyId],blockNumber}),
  p.readContract({address:policy.vault,abi:automationVaultAbi,functionName:'lifetimeSpent',args:[policy.policyId],blockNumber}),
 ]);
 const now=vault.block.timestamp.toString(),period=periodAt(policy,now);
 const used=period!==null?await p.readContract({address:policy.vault,abi:automationVaultAbi,functionName:'periodConsumed',args:[policy.policyId,BigInt(period)],blockNumber}):false;
 const enabledExecutor=executor?await p.readContract({address:policy.vault,abi:automationVaultAbi,functionName:'executors',args:[executor],blockNumber}):false;
 const snapshot:StudioSnapshot={now,blockNumber:blockNumber.toString(),balance:vault.balance,committedBills:vault.committedBills,buffer:vault.buffer,protectionExpiresAt:vault.expires,protectionSourceHash:vault.sourceHash,currentSourceHash,globalBudget:vault.globalBudget,globalSpent:vault.globalSpent,allocation:allocation.toString(),otherAllocations:(BigInt(vault.totalAllocated)-allocation).toString(),lifetimeSpent:lifetimeSpent.toString(),periodSpent:used?policy.amount:'0',consumedPeriods:used&&period!==null?[period]:[]};
 if((await p.getBlock({blockNumber})).hash!==vault.block.hash)throw new Error('Automation policy snapshot changed.');
 return {vault,actual,snapshot,enabledExecutor};
}
