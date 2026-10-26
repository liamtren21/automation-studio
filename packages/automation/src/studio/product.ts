import {hashPolicy,type StudioPolicy} from './index';
export type RuntimeState='simulation'|'not_configured'|'offline'|'online';
export function runtimeState(mode:'demo'|'live',heartbeat?:{at:string},now=Math.floor(Date.now()/1000)):RuntimeState{
 if(mode==='demo')return 'simulation';
 if(!heartbeat)return 'not_configured';
 const at=Number(heartbeat.at);return Number.isSafeInteger(at)&&at<=now&&now-at<=120?'online':'offline';
}
export function publicPolicyExport(policy:StudioPolicy){return{schema:'AutomationStudio.Policy.v1',policy:Object.fromEntries((['chainId','vault','policyId','version','recipient','amount','startAt','endAt','intervalSeconds','perRunCap','perPeriodCap','lifetimeCap','priority','enabled'] as const).map(key=>[key,policy[key]])),policyHash:hashPolicy(policy),execution:'Requires confirmed owner permissions, allocation, current protection and a separately configured executor. No signer secrets are included.'};}
export function repaymentProposal(input:{debt:string;minimumDebt:string;gasCompensation:string;walletBalance:string;treasurySurplus:string}){
 const values=Object.values(input);if(values.some(v=>!/^\d+$/.test(v)))throw new Error('Expected unsigned base units');
 const debt=BigInt(input.debt),floor=BigInt(input.minimumDebt)+BigInt(input.gasCompensation),max=debt>floor?debt-floor:0n;
 const wallet=BigInt(input.walletBalance),surplus=BigInt(input.treasurySurplus);
 return{maximumPartialRepayment:max.toString(),fromWallet:(wallet<max?wallet:max).toString(),surplusForSeparateWithdrawal:(surplus<max?surplus:max).toString(),automatic:false as const};
}
