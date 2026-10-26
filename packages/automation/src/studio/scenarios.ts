import {decideStudio} from './decide';
import type {StudioPolicy,StudioSnapshot,StudioReason} from './types';
import {keccak256,toHex} from 'viem';
const units=(value:number)=>(BigInt(value)*10n**18n).toString();
export interface SavedScenario {id:string;title:string;description:string;mode:'simulated';before:string;after:string;action:string;outcomes:{bot:string;reason:StudioReason;allowed:boolean}[]}
/** Fixed teaching examples: never derived from or written into a user's live account. */
export function savedScenarios():SavedScenario[] {
 const hash=keccak256(toHex('scenario protection'));
 const policy:StudioPolicy={chainId:'31611',vault:'0x1111111111111111111111111111111111111111',policyId:keccak256(toHex('example bot')),version:'1',recipient:'0x2222222222222222222222222222222222222222',amount:units(20),startAt:'100',endAt:'10000',intervalSeconds:'600',perRunCap:units(20),perPeriodCap:units(20),lifetimeCap:units(100),priority:'1',enabled:true};
 const snapshot:StudioSnapshot={now:'100',blockNumber:'0',balance:units(50),committedBills:units(10),buffer:units(10),protectionExpiresAt:'10000',protectionSourceHash:hash,currentSourceHash:hash,globalBudget:units(100),globalSpent:'0',allocation:units(20),otherAllocations:units(10),lifetimeSpent:'0',periodSpent:'0',consumedPeriods:[]};
 const outcome=(bot:string,s:StudioSnapshot,p=policy)=>{const d=decideStudio(s,p);return {bot,reason:d.reasonCode,allowed:d.allowed};};
 return [
  {id:'shared-budget',title:'Two bots, one cash balance',description:'Priority changes how funds are proposed; each bot still needs its own allocation.',mode:'simulated',before:'50 MUSD held; 20 protected; 30 available for bots.',after:'Bot A can pay 20. Bot B has 10 allocated and cannot pay 20.',action:'Adjust the allocations or add funds, then review the updated limits.',outcomes:[outcome('Bot A',snapshot),outcome('Bot B',{...snapshot,balance:units(30),globalSpent:units(20),allocation:units(10),otherAllocations:'0'})]},
  {id:'new-obligation',title:'A new bill changes your plan',description:'Saving a bill updates the cash plan. It needs a new onchain protection approval.',mode:'simulated',before:'The approved cash plan matches the account.',after:'A new bill changes the plan fingerprint. Payments wait for owner review.',action:'Review updated cash protection before the next payment.',outcomes:[outcome('Supplier payment',{...snapshot,currentSourceHash:keccak256(toHex('new bill'))})]},
  {id:'revoked',title:'Stop a bot before its next payment',description:'Revoking permission stops future executions after the stop transaction is confirmed.',mode:'simulated',before:'The bot has an approved recurring payment.',after:'The disabled permission blocks the next payment. Completed payments remain in history.',action:'Review the stop transaction and wait for confirmation; a transaction already broadcast may still complete.',outcomes:[outcome('Stopped bot',snapshot,{...policy,enabled:false})]},
 ];
}
