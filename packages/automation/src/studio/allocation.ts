import {integer,type StudioPolicy} from './types';
import type {PortfolioAccount} from './portfolio';

export interface AllocationOperation {policyId:string;kind:'release'|'allocate';amount:string;fromAllocation:string;toAllocation:string;requiresOwnerReview:true}
export interface PriorityAllocationRule {policyId:string;priority:string;currentAllocation:string;requestedTarget:string;proposedTarget:string;extraDelta:string;releaseNeeded:string;waitingAmount:string;status:'funded'|'partial'|'waiting'|'inactive'}
export interface PriorityAllocationProposal {protectedFloor:string;existingCashCapacity:string;globalRemaining:string;capacity:string;currentAllocated:string;unassignedCapacity:string;reservedForOtherRules:string;totalProposed:string;additionalFundsNeeded:string;releasesNeeded:string;rules:PriorityAllocationRule[];operations:AllocationOperation[];requiresOwnerReview:true;automatic:false}
const max0=(n:bigint)=>n>0n?n:0n;
const min=(a:bigint,b:bigint)=>a<b?a:b;

/** A review proposal only. Releases must be confirmed before dependent allocations. */
export function proposePriorityAllocation(account:PortfolioAccount,policies:readonly StudioPolicy[],requestedTargets:Record<string,string>={}):PriorityAllocationProposal {
 const allocations=new Map<string,bigint>(),spent=new Map<string,bigint>(),targets=new Map<string,bigint>();
 for(const [key,value] of Object.entries(account.allocations)){const id=key.toLowerCase();if(allocations.has(id))throw new Error('Duplicate allocation identifier');allocations.set(id,integer(value));}
 for(const [key,value] of Object.entries(account.spent)){const id=key.toLowerCase();if(spent.has(id))throw new Error('Duplicate spending identifier');spent.set(id,integer(value));}
 for(const [key,value] of Object.entries(requestedTargets)){const id=key.toLowerCase();if(targets.has(id))throw new Error('Duplicate requested identifier');targets.set(id,integer(value));}
 const ids=new Set<string>();
 for(const p of policies){const id=p.policyId.toLowerCase();if(ids.has(id))throw new Error('Duplicate policy identifier');ids.add(id);integer(p.priority);integer(p.lifetimeCap);integer(p.endAt);}
 for(const id of targets.keys())if(!ids.has(id))throw new Error('Requested allocation must name a known rule');
 const now=integer(account.now),floor=integer(account.committedBills)+integer(account.buffer),cash=max0(integer(account.balance)-floor),global=max0(integer(account.globalBudget)-integer(account.globalSpent)),capacity=min(cash,global);
 const active=new Set(policies.filter(p=>p.enabled&&integer(p.endAt)>now).map(p=>p.policyId.toLowerCase()));
 const current=[...allocations.values()].reduce((n,v)=>n+v,0n),reserved=[...allocations.entries()].filter(([id])=>!active.has(id)).reduce((n,[,v])=>n+v,0n);
 let available=max0(capacity-reserved),demand=0n,total=0n,released=0n;
 const rules:PriorityAllocationRule[]=[],operations:AllocationOperation[]=[];
 const sorted=[...policies].sort((a,b)=>integer(a.priority)<integer(b.priority)?-1:integer(a.priority)>integer(b.priority)?1:a.policyId.toLowerCase().localeCompare(b.policyId.toLowerCase()));
 for(const p of sorted){
  const id=p.policyId.toLowerCase(),existing=allocations.get(id)??0n,remaining=max0(integer(p.lifetimeCap)-(spent.get(id)??0n));
  if(!active.has(id)){rules.push({policyId:id,priority:p.priority,currentAllocation:existing.toString(),requestedTarget:'0',proposedTarget:existing.toString(),extraDelta:'0',releaseNeeded:'0',waitingAmount:'0',status:'inactive'});continue;}
  const requested=min(targets.get(id)??remaining,remaining),proposed=min(requested,available),extra=max0(proposed-existing),release=max0(existing-proposed),waiting=requested-proposed;
  available-=proposed;demand+=requested;total+=proposed;released+=release;
  rules.push({policyId:id,priority:p.priority,currentAllocation:existing.toString(),requestedTarget:requested.toString(),proposedTarget:proposed.toString(),extraDelta:extra.toString(),releaseNeeded:release.toString(),waitingAmount:waiting.toString(),status:waiting===0n?'funded':proposed===0n?'waiting':'partial'});
  if(extra>0n||release>0n)operations.push({policyId:id,kind:release>0n?'release':'allocate',amount:(release>0n?release:extra).toString(),fromAllocation:existing.toString(),toAllocation:proposed.toString(),requiresOwnerReview:true});
 }
 operations.sort((a,b)=>a.kind===b.kind?0:a.kind==='release'?-1:1);
 return {protectedFloor:floor.toString(),existingCashCapacity:cash.toString(),globalRemaining:global.toString(),capacity:capacity.toString(),currentAllocated:current.toString(),unassignedCapacity:max0(capacity-current).toString(),reservedForOtherRules:reserved.toString(),totalProposed:total.toString(),additionalFundsNeeded:max0(demand-max0(capacity-reserved)).toString(),releasesNeeded:released.toString(),rules,operations,requiresOwnerReview:true,automatic:false};
}
