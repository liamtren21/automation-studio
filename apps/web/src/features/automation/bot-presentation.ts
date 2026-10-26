import type {StudioRule} from './studio-client';
import {nextPaymentWindow} from '../../../../../packages/automation/src/studio/readiness';
export function frequencyLabel(seconds:string){
 const n=Number(seconds);
 if(n===86400)return 'Daily';if(n===604800)return 'Weekly';if(n===2592000)return 'Every 30 days';
 if(n%86400===0)return `Every ${n/86400} days`;
 if(n%3600===0)return `Every ${n/3600} hours`;
 if(n%60===0)return `Every ${n/60} minutes`;
 return `Every ${n} seconds`;
}
export const shortAddress=(address:string)=>address.slice(0,6)+'…'+address.slice(-4);
export function botPresentation(rule:StudioRule):{status:string;message:string;nextAt:string|null}{
 if(rule.status==='revoked')return {status:'Stopped',message:'No more payments will be sent.',nextAt:null};
 if(rule.status==='draft')return {status:'Draft',message:'Finish setup to start payments.',nextAt:null};
 if(rule.status==='paused')return {status:'Paused',message:'Payments are paused for your account.',nextAt:null};
 if(BigInt(rule.snapshot.now)>=BigInt(rule.policy.endAt))return {status:'Ended',message:'This payment schedule has finished.',nextAt:null};
 if(rule.status!=='active'||!rule.policy.enabled)return {status:'Not active',message:'This bot is not sending payments.',nextAt:null};
 if(rule.policy.lifetimeCap!==undefined&&BigInt(rule.snapshot.lifetimeSpent??'0')+BigInt(rule.policy.amount)>BigInt(rule.policy.lifetimeCap))return {status:'Budget reached',message:'The remaining budget cannot cover another payment.',nextAt:null};
 if(rule.snapshot.globalBudget!==undefined&&BigInt(rule.snapshot.globalSpent??'0')+BigInt(rule.policy.amount)>BigInt(rule.snapshot.globalBudget))return {status:'Budget reached',message:'Your account spending limit needs an update.',nextAt:null};
 const next=nextPaymentWindow(rule.policy,rule.snapshot.now,rule.snapshot.consumedPeriods);
 const code=rule.decision.reasonCode;
 if(code==='LIFETIME_CAP'||code==='GLOBAL_CAP')return {status:'Budget reached',message:'The spending limit has been reached.',nextAt:null};
 if(!next)return {status:'Finished',message:'All scheduled payments are complete.',nextAt:null};
 if(['NOT_DUE','PERIOD_USED'].includes(code))return {status:'Scheduled',message:'Your next payment is scheduled.',nextAt:next.start};
 if(code==='ALLOWED')return {status:'Ready to pay',message:'The payment service is checking this payment.',nextAt:next.start};
 const messages:Record<string,string>={ALLOCATION_CAP:'Add money to this bot’s budget to continue.',INSUFFICIENT_FREE_CASH:'Add funds or adjust your cash reserve.',PROTECTION_STALE:'Update your cash reserve in Settings.',GAS_LOW:'The payment service needs network fees.',TX_UNRESOLVED:'An earlier payment is still being checked.',RPC_UNAVAILABLE:'We cannot check the network right now.'};
 return {status:code==='TX_UNRESOLVED'?'Payment pending':'Needs attention',message:messages[code]??'Open this bot to check what needs to be updated.',nextAt:null};
}
