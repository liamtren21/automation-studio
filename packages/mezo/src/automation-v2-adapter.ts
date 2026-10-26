import {encodeFunctionData,decodeFunctionData,getAddress,isAddress,numberToHex,padHex,zeroAddress,type Address,type Hex,type PublicClient} from 'viem';
import {automationV2Artifact} from './automation-v2-artifact';
import {readTroveSnapshot,troveDeployment,type TroveSnapshot} from './trove-read';
import {repaymentEconomics} from './repayment';

/** No existing vault, worker or UI capability is promoted by importing this module. */
export const automationV2Capabilities={contract:'AutomationAccountV2',requiresNewDeployment:true,defaultEnabled:false,liveWorkerEnabled:false,verification:'local-mocks-only',realForkGate:'pending',liveGate:'pending',maxPayees:20,protocolTrust:'Upgradeable protocol; offchain implementation pin can only fail closed before submission.'} as const;
export interface V2Identity {account:Address;owner:Address;globalBudget:bigint}
export interface V2Policy {id:Hex;version:bigint;kind:0|1|2;startAt:bigint;endAt:bigint;interval:bigint;runCap:bigint;periodCap:bigint;lifetimeCap:bigint;enabled:boolean}
const positive=(n:bigint)=>{if(n<=0n||n>2n**256n-1n)throw new Error('Positive uint256 required');};
const validAddress=(a:string)=>{if(!isAddress(a)||getAddress(a)===zeroAddress)throw new Error('Valid nonzero address required');return getAddress(a);};
function validIdentity(i:V2Identity){validAddress(i.account);validAddress(i.owner);if(getAddress(i.account)===getAddress(i.owner))throw new Error('Owner must be a distinct signing address');positive(i.globalBudget);}
export function validateV2Policy(p:V2Policy,payees:readonly Address[],values:readonly bigint[],account?:Address){
 if(!/^0x[0-9a-fA-F]{64}$/.test(p.id)||BigInt(p.id)===0n||![0,1,2].includes(p.kind))throw new Error('Invalid policy identity or kind');
 [p.version,p.interval,p.runCap,p.periodCap,p.lifetimeCap].forEach(positive);
 if(p.startAt<0n||p.endAt<=p.startAt)throw new Error('Invalid schedule');
 if(p.kind===2){if(payees.length!==0||values.length!==1)throw new Error('Repayment has one amount and account-owned debt');positive(values[0]!);}
 else {if(payees.length===0||payees.length>20||values.length!==payees.length)throw new Error('One to twenty fixed payees required');
 const seen=new Set<string>();for(const r of payees){const a=validAddress(r);if((account&&a===getAddress(account))||seen.has(a))throw new Error('Duplicate or self payee');seen.add(a);}values.forEach(positive);}
 const sum=values.reduce((a,b)=>a+b,0n);
 if(p.kind===1){if(sum>10000n)throw new Error('Split weights exceed 10000 bps; remainder retained');}
 else if(sum>p.runCap||sum>p.periodCap||sum>p.lifetimeCap)throw new Error('Aggregate payment exceeds a cap');
}
/** Exact compiled runtime with every occurrence of every immutable patched, including owner/protocol/budget. */
export function expectedV2Runtime(i:V2Identity):Hex {
 validIdentity(i);let code=automationV2Artifact.runtimeTemplate as string;
 const immutableValues={token:troveDeployment.musd,owner:i.owner,globalBudget:i.globalBudget,deploymentChainId:31611n,operations:troveDeployment.borrowerOperations,troveManager:troveDeployment.troveManager};
 for(const [name,ranges] of Object.entries(automationV2Artifact.immutableReferences)){
  const value=immutableValues[name as keyof typeof immutableValues];const word=typeof value==='bigint'?numberToHex(value,{size:32}):padHex(getAddress(value),{size:32});
  for(const r of ranges){if(r.length!==32)throw new Error('Unexpected immutable size');const start=2+r.start*2;code=code.slice(0,start)+word.slice(2)+code.slice(start+r.length*2);}
 }
 return code as Hex;
}
export function verifyV2Runtime(i:V2Identity,code:Hex|undefined){if(!code||code.toLowerCase()!==expectedV2Runtime(i).toLowerCase())throw new Error('Unreviewed V2 account runtime or immutable identity; existing vaults are unsupported');}
export type V2OwnerAction=
 |{type:'configure';policy:V2Policy;payees:readonly Address[];values:readonly bigint[];explicitlyApprovedEnable?:boolean}
 |{type:'depositCapital'|'classifyCapital';amount:bigint}
 |{type:'depositRevenue';id:Hex;amount:bigint}
 |{type:'allocate';id:Hex;amount:bigint;fromRevenue:boolean}
 |{type:'release';id:Hex;amount:bigint}
 |{type:'releaseSplit';id:Hex;recipient:Address;amount:bigint}
 |{type:'setProtection';committed:bigint;buffer:bigint;evidence:Hex;expiresAt:bigint}
 |{type:'setExecutor';executor:Address;allowed:boolean}
 |{type:'revoke';id:Hex}
 |{type:'pause'|'unpause'|'closeLoan'|'claimSurplus'}
 |{type:'openLoan';amount:bigint;collateral:bigint;upper?:Address;lower?:Address}
 |{type:'topUp';collateral:bigint;upper?:Address;lower?:Address}
 |{type:'withdrawFree'|'recoverNative';recipient:Address;amount:bigint};
/** Pure, reviewable owner-signing request. MUST pass preflightV2Account and simulation on signing device.
 * depositCapital/depositRevenue need a separate exact owner->account token allowance; BO never needs allowance.
 */
export function prepareV2OwnerAction(i:V2Identity,a:V2OwnerAction){
 validIdentity(i);let args:readonly unknown[]=[];let value=0n;const name=a.type;
 switch(a.type){
 case 'configure':validateV2Policy(a.policy,a.payees,a.values,i.account);if(a.policy.enabled&&a.explicitlyApprovedEnable!==true)throw new Error('Explicit owner review required to enable automation');args=[a.policy,a.payees,a.values];break;
 case 'depositCapital':case 'classifyCapital':positive(a.amount);args=[a.amount];break;
 case 'depositRevenue':case 'release':positive(a.amount);args=[a.id,a.amount];break;
 case 'allocate':positive(a.amount);args=[a.id,a.amount,a.fromRevenue];break;
 case 'releaseSplit':positive(a.amount);args=[a.id,validAddress(a.recipient),a.amount];break;
 case 'setProtection':if(a.committed<0n||a.buffer<0n||!/^0x[0-9a-fA-F]{64}$/.test(a.evidence)||BigInt(a.evidence)===0n)throw new Error('Explicit floor evidence required');positive(a.expiresAt);args=[a.committed,a.buffer,a.evidence,a.expiresAt];break;
 case 'setExecutor':args=[validAddress(a.executor),a.allowed];break;
 case 'revoke':args=[a.id];break;
 case 'openLoan':positive(a.amount);positive(a.collateral);value=a.collateral;args=[a.amount,a.upper??zeroAddress,a.lower??zeroAddress];break;
 case 'topUp':positive(a.collateral);value=a.collateral;args=[a.upper??zeroAddress,a.lower??zeroAddress];break;
 case 'withdrawFree':case 'recoverNative':positive(a.amount);if(getAddress(a.recipient)===getAddress(i.account))throw new Error('Self recipient forbidden');args=[validAddress(a.recipient),a.amount];break;
 }
 const data=encodeFunctionData({abi:automationV2Artifact.abi,functionName:name,args} as Parameters<typeof encodeFunctionData>[0]);
 return {chainId:31611 as const,from:i.owner,to:i.account,data,value,requiresOwnerSignature:true as const,requiresPreflight:true as const,protocolTarget:troveDeployment.borrowerOperations,approvalRequired:a.type==='depositCapital'||a.type==='depositRevenue'};
}
type Client=Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'getStorageAt'|'readContract'|'getBalance'|'simulateContract'>;
export async function preflightV2Account(client:Client,i:V2Identity,now=Math.floor(Date.now()/1000)){
 validIdentity(i);if(!Number.isSafeInteger(now)||now<0)throw new Error('Invalid current time');
 // Existing reader verifies all pinned proxy implementations, deployment links and canonical block.
 const snapshot=await readTroveSnapshot(client,i.account);
 if(snapshot.blockTimestamp>now||now-snapshot.blockTimestamp>=30)throw new Error('V2 protocol snapshot stale');
 const code=await client.getCode({address:i.account,blockNumber:BigInt(snapshot.blockNumber)});verifyV2Runtime(i,code);
 if((await client.getBlock({blockNumber:BigInt(snapshot.blockNumber)})).hash!==snapshot.blockHash)throw new Error('V2 account block changed');
 return {snapshot,expiresAt:snapshot.blockTimestamp+30,protocolRemainsUpgradeable:true as const};
}
export async function prepareV2OwnerActionChecked(client:Client,i:V2Identity,a:V2OwnerAction,now?:number){
 const prepared=prepareV2OwnerAction(i,a),preflight=await preflightV2Account(client,i,now);
 await client.simulateContract({address:i.account,abi:automationV2Artifact.abi,functionName:a.type,args:decodeFunctionData({abi:automationV2Artifact.abi,data:prepared.data}).args??[],account:i.owner,value:prepared.value,blockNumber:BigInt(preflight.snapshot.blockNumber)} as unknown as Parameters<Client['simulateContract']>[0]);
 if((await client.getBlock({blockNumber:BigInt(preflight.snapshot.blockNumber)})).hash!==preflight.snapshot.blockHash)throw new Error("V2 simulation block changed");
 return {...prepared,...preflight};
}
/** Readonly LOCAL preparation. It cannot be plugged into the existing worker or enable live execution. */
export async function prepareV2LocalExecution(client:Client,i:V2Identity,input:{executor:Address;id:Hex;version:bigint;period:bigint;upper?:Address;lower?:Address;live?:boolean},now?:number){
 if(input.live)throw new Error('V2 live worker gate pending real protocol fork and dedicated new-deployment review');
 const preflight=await preflightV2Account(client,i,now),n=BigInt(preflight.snapshot.blockNumber);
 const p=await client.readContract({address:i.account,abi:automationV2Artifact.abi,functionName:'policyOf',args:[input.id],blockNumber:n});
 if(p.kind===2){const [,v]=await client.readContract({address:i.account,abi:automationV2Artifact.abi,functionName:'payeesOf',args:[input.id],blockNumber:n});repaymentEconomics(preflight.snapshot,v[0]!.toString());}
 const args=[input.id,input.version,input.period,input.upper??zeroAddress,input.lower??zeroAddress] as const;
 await client.simulateContract({address:i.account,abi:automationV2Artifact.abi,functionName:'execute',args,account:validAddress(input.executor),blockNumber:n});
 if((await client.getBlock({blockNumber:n})).hash!==preflight.snapshot.blockHash)throw new Error("V2 simulation block changed");
 return {chainId:31611 as const,to:i.account,from:input.executor,data:encodeFunctionData({abi:automationV2Artifact.abi,functionName:'execute',args}),value:0n,localOnly:true as const,liveWorkerEnabled:false as const,...preflight};
}
export type V2PreflightSnapshot=TroveSnapshot;



