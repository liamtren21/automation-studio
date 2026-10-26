'use client';
import {formatUnits} from 'viem';
import type {StudioRule,StudioView} from './studio-client';
import type {LiveIntent} from './transaction-review';
export function ActivationSteps({rule,view,onReview,onSettings}:{rule:StudioRule;view:StudioView;onReview:(intent:LiveIntent)=>void;onSettings:(section:'funds'|'service')=>void}){
 const a=view.account;if(!a)return null;
 const protectionCurrent=view.source?.sourceHash.toLowerCase()===a.protectionSourceHash.toLowerCase()&&BigInt(a.protectionExpiresAt)>BigInt(a.now);
 const allocated=BigInt(rule.snapshot.allocation),minimum=BigInt(rule.policy.amount),remaining=BigInt(rule.policy.lifetimeCap)-BigInt(rule.snapshot.lifetimeSpent);
 const free=BigInt(a.balance)-BigInt(a.committedBills)-BigInt(a.buffer)-Object.values(a.allocations).reduce((n,v)=>n+BigInt(v),0n);
 let title:string,detail:string,button:string|undefined,intent:LiveIntent|undefined,settingsTarget:'funds'|'service'='service';
 if(!protectionCurrent){title='Confirm your protected funds';detail='Approve your current bills and cash cushion before reserving money for this bot.';button='Review protected funds';intent={operation:'protection'};}
 else if(view.paused){title='Payments are paused';detail='Resuming this account allows all approved bots to be considered again.';button='Review resume all bots';intent={operation:'unpause'};}
 else if(rule.status==='revoked'){title='This permission was stopped';detail='Create a new version and review its recipient, limits and schedule before restarting.';}
 else if(rule.status!=='active'){title='Approve this payment permission';detail='Your wallet will show the exact recipient, limits and end date. No payment is sent by this approval.';button='Review permission in OKX';intent={operation:'configure',policyId:rule.policy.policyId};}
 else if(allocated<minimum){
  title='Set aside money for this bot';
  const desired=remaining-allocated,proposed=desired<free?desired:free;
  if(proposed>=minimum-allocated){detail='Your permission is approved. Reserve funds next; money protected for bills stays untouched.';button='Review bot budget in OKX';intent={operation:'allocate',policyId:rule.policy.policyId,amount:formatUnits(proposed,18)};}
  else{detail='Add MUSD or review available allocations to cover at least the next payment.';button='Manage funds';settingsTarget='funds';}
 }
 else if(view.runtimeHealth?.authorized!==true){title='Enable the payment service';detail='Grant only the restricted executor permission on this account.';if(view.runtimeHealth?.executorAddress){button='Review executor access';intent={operation:'executor',executor:view.runtimeHealth.executorAddress,allowed:true};}else button='Check payment service';}
 else if(view.runtimeHealth.gasBalance===null||view.runtimeHealth.gasBalance==='0'){title='The payment service needs test BTC';detail='Network fees come from the dedicated executor. Add test BTC to that address in Settings.';button='View fee address';}
 else if(!view.runtimeHealth.executionEnabled){title='Waiting for the payment service';detail='Your permissions and funds are ready. The hosted executor must be enabled before automatic payments can run.';button='View service status';}
 else{title='Your bot is ready for its next window';detail='The service still checks gas, available cash and current permissions before each payment. Follow the result in Activity.';}
 return <section className="as-soft" aria-label="Activation progress"><h3>{title}</h3><p>{detail}</p>{button&&<button className="as-button as-primary" onClick={()=>intent?onReview(intent):onSettings(settingsTarget)}>{button}</button>}<p className="as-small">Each approval is separate. We recheck confirmed state before showing your next step.</p></section>;
}
