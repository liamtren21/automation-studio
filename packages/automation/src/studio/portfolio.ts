import {decideStudio} from './decide';
import {integer,type StudioPolicy} from './types';
export interface PortfolioAccount {now:string;balance:string;committedBills:string;buffer:string;globalBudget:string;globalSpent:string;protectionSourceHash:string;protectionExpiresAt:string;allocations:Record<string,string>;spent:Record<string,string>;consumed:Record<string,string[]>}
export interface PortfolioDay {at:string;balance:string;paid:string;blocked:number;belowFloor:boolean;events:{policyId:string;reason:string;amount:string}[];hypotheticalBalance:string;delayedIncomeBalance:string;expectedIncome:string;delayedIncome:string;repaymentExpense:string;hypotheticalBelowFloor:boolean;delayedIncomeBelowFloor:boolean}
export interface PortfolioScenario {extraExpense?:string;expenseDay?:number;expectedIncome?:string;incomeDay?:number;incomeDelayDays?:number;repaymentExpense?:string;repaymentDay?:number}
/** Scenario only. Every event uses the runtime evaluator; no assumed income is credited. */
export function forecastPortfolio(input:PortfolioAccount,policies:readonly StudioPolicy[],days=30,scenario:PortfolioScenario={}):PortfolioDay[] {
 if(!Number.isSafeInteger(days)||days<1||days>90)throw new Error('Forecast horizon must be 1–90 days.');
 for(const key of ['expenseDay','incomeDay','repaymentDay'] as const){const day=scenario[key];if(day!==undefined&&(!Number.isSafeInteger(day)||day<0||day>=days))throw new Error(`${key} is outside the forecast.`);}
 if(scenario.incomeDelayDays!==undefined&&(!Number.isSafeInteger(scenario.incomeDelayDays)||scenario.incomeDelayDays<0||scenario.incomeDelayDays>90))throw new Error('Income delay must be 0–90 days.');
 const expense=integer(scenario.extraExpense??'0'),income=integer(scenario.expectedIncome??'0'),repayment=integer(scenario.repaymentExpense??'0');
 for(const key of ['now','balance','committedBills','buffer','globalBudget','globalSpent','protectionExpiresAt'] as const)integer(input[key]);
 for(const value of [...Object.values(input.allocations),...Object.values(input.spent)])integer(value);
 const a={...input,allocations:{...input.allocations},spent:{...input.spent},consumed:Object.fromEntries(Object.entries(input.consumed).map(([id,v])=>[id,[...v]]))},start=integer(input.now),end=start+BigInt(days)*86400n;
 const events:{at:bigint;p:StudioPolicy}[]=[];
 for(const p of policies.filter(p=>p.enabled)){const first=integer(p.startAt),step=integer(p.intervalSeconds);if(step===0n)throw new Error('Positive interval required.');let at=start<=first?first:first+((start-first)/step)*step;if(at<start)at+=step;for(;at<end&&at<integer(p.endAt);at+=step){if(events.length>=10000)throw new Error('Too many forecast events. Use a longer interval.');events.push({at,p});}}
 events.sort((x,y)=>x.at<y.at?-1:x.at>y.at?1:integer(x.p.priority)<integer(y.p.priority)?-1:integer(x.p.priority)>integer(y.p.priority)?1:x.p.policyId.localeCompare(y.p.policyId));
 const rows:PortfolioDay[]=[];let cursor=0,hypothetical=integer(input.balance),delayed=integer(input.balance);
 for(let day=0;day<days;day++){
  const at=start+BigInt(day)*86400n,until=at+86400n,row:PortfolioDay={at:at.toString(),balance:a.balance,paid:'0',blocked:0,belowFloor:false,events:[],hypotheticalBalance:'0',delayedIncomeBalance:'0',expectedIncome:'0',delayedIncome:'0',repaymentExpense:'0',hypotheticalBelowFloor:false,delayedIncomeBelowFloor:false};
  const outgoing=(day===(scenario.expenseDay??0)?expense:0n)+(day===(scenario.repaymentDay??0)?repayment:0n);
  a.balance=(integer(a.balance)>outgoing?integer(a.balance)-outgoing:0n).toString();hypothetical-=outgoing;delayed-=outgoing;
  if(day===(scenario.incomeDay??0)){hypothetical+=income;row.expectedIncome=income.toString();}
  if(day===(scenario.incomeDay??0)+(scenario.incomeDelayDays??0)){delayed+=income;row.delayedIncome=income.toString();}
  if(day===(scenario.repaymentDay??0))row.repaymentExpense=repayment.toString();
  while(cursor<events.length&&events[cursor].at<until){const {at:time,p}=events[cursor++],id=p.policyId.toLowerCase(),allocation=a.allocations[id]??'0',all=Object.values(a.allocations).reduce((n,v)=>n+integer(v),0n);
   const decision=decideStudio({now:time.toString(),blockNumber:'0',balance:a.balance,committedBills:a.committedBills,buffer:a.buffer,protectionExpiresAt:a.protectionExpiresAt,protectionSourceHash:a.protectionSourceHash,currentSourceHash:a.protectionSourceHash,globalBudget:a.globalBudget,globalSpent:a.globalSpent,allocation,otherAllocations:(all-integer(allocation)).toString(),lifetimeSpent:a.spent[id]??'0',periodSpent:'0',consumedPeriods:a.consumed[id]??[]},p);
   row.events.push({policyId:id,reason:decision.reasonCode,amount:p.amount});
   if(decision.allowed){const amount=integer(p.amount);a.balance=(integer(a.balance)-amount).toString();a.globalSpent=(integer(a.globalSpent)+amount).toString();a.allocations[id]=(integer(allocation)-amount).toString();a.spent[id]=(integer(a.spent[id]??'0')+amount).toString();a.consumed[id]=[...(a.consumed[id]??[]),decision.periodIndex!];row.paid=(integer(row.paid)+amount).toString();}else row.blocked++;
  }
  hypothetical-=integer(row.paid);delayed-=integer(row.paid);const floor=integer(a.committedBills)+integer(a.buffer);
  row.balance=a.balance;row.belowFloor=integer(a.balance)<floor;row.hypotheticalBalance=hypothetical.toString();row.delayedIncomeBalance=delayed.toString();row.hypotheticalBelowFloor=hypothetical<floor;row.delayedIncomeBelowFloor=delayed<floor;rows.push(row);
 }
 return rows;
}
