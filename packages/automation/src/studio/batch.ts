import {formatUnits,getAddress,isAddress,parseUnits,zeroAddress,type Address,type Hex} from 'viem';
import type {V2Policy} from '../../../mezo/src/automation-v2-adapter';
export type BatchScheduleKind='once'|'daily'|'weekly';
export interface BatchInput {name:string;recipients:{address:string;amount:string}[];schedule:{kind:BatchScheduleKind;startAt:string;endAt:string};lifetimeBudget:string}
/** Unsigned draft. Every amount is a base-unit decimal string, and times are UTC seconds. */
export interface BatchDraft {schemaVersion:1;name:string;recipients:{address:Address;amount:string}[];schedule:{kind:BatchScheduleKind;startAt:string;endAt:string;intervalSeconds:string};totalPerBatch:string;lifetimeBudget:string;enabled:false}
const MAX=2n**256n-1n;
const uint=(s:unknown,label:string)=>{if(typeof s!=='string'||s.length>78||!/^(0|[1-9]\d*)$/.test(s)||BigInt(s)>MAX)throw Error(label+' is invalid.');return BigInt(s);};
function amount(s:unknown,label:string){if(typeof s!=='string'||s.length>100||!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(s))throw Error(label+' must be a positive MUSD amount with up to 18 decimal places.');const n=parseUnits(s,18);if(n<=0n||n>MAX)throw Error(label+' is outside the supported amount.');return n;}
const address=(s:unknown)=>{if(typeof s!=='string'||!isAddress(s)||getAddress(s)===zeroAddress)throw Error('Enter a valid recipient wallet address.');return getAddress(s);};
export function createBatchDraft(input:BatchInput):BatchDraft {
 if(!input||typeof input!=='object'||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)throw Error('Enter a payment name, up to 80 characters.');
 if(!Array.isArray(input.recipients)||input.recipients.length<2||input.recipients.length>20)throw Error('Add between 2 and 20 recipients.');
 const seen=new Set<string>();let total=0n;
 const recipients=input.recipients.map((r,i)=>{const a=address(r?.address);if(seen.has(a.toLowerCase()))throw Error('Each recipient can appear only once.');seen.add(a.toLowerCase());const n=amount(r?.amount,'Amount for recipient '+(i+1));total+=n;if(total>MAX)throw Error('The whole batch amount is too large.');return {address:a,amount:n.toString()};});
 const schedule=input.schedule;if(!schedule||!['once','daily','weekly'].includes(schedule.kind))throw Error('Choose a payment frequency.');
 const start=uint(schedule.startAt,'First payment'),end=uint(schedule.endAt,'End date');if(start>253402300799n||end>253402300799n)throw Error('Choose a supported date before year 10000.');if(end<=start)throw Error('Choose an end date after the first payment.');
 const interval=schedule.kind==='weekly'?604800n:86400n;
 if(schedule.kind==='once'&&end-start!==86400n)throw Error('A one-time payment needs a 24-hour payment window.');
 const budget=amount(input.lifetimeBudget,'Total budget');if(budget<total)throw Error('Total budget must cover at least one whole batch.');
 return {schemaVersion:1,name:input.name.trim(),recipients,schedule:{kind:schedule.kind,startAt:start.toString(),endAt:end.toString(),intervalSeconds:interval.toString()},totalPerBatch:total.toString(),lifetimeBudget:budget.toString(),enabled:false};
}
export function validateBatchDraft(value:unknown):BatchDraft {
 if(!value||typeof value!=='object')throw Error('Invalid batch draft.');const draft=value as BatchDraft;
 if(draft.schemaVersion!==1||draft.enabled!==false||!Array.isArray(draft.recipients))throw Error('Only an unsigned batch draft can be saved.');
 const normalized=createBatchDraft({name:draft.name,recipients:draft.recipients.map(r=>({address:r?.address,amount:formatUnits(uint(r?.amount,'Recipient amount'),18)})),schedule:draft.schedule,lifetimeBudget:formatUnits(uint(draft.lifetimeBudget,'Total budget'),18)});
 if(normalized.totalPerBatch!==draft.totalPerBatch||normalized.schedule.intervalSeconds!==draft.schedule?.intervalSeconds)throw Error('Batch totals or schedule do not match the recipient details.');
 return normalized;
}
export function buildBatchPolicy(draft:BatchDraft,identity:{id:Hex;version?:string;account?:Address}):{policy:V2Policy;payees:Address[];values:bigint[]} {
 const d=validateBatchDraft(draft);
 if(!/^0x[0-9a-fA-F]{64}$/.test(identity.id)||BigInt(identity.id)===0n)throw Error('A nonzero payment identity is required.');
 const version=uint(identity.version??'1','Version');if(version===0n)throw Error('Version must be positive.');
 const account=identity.account?address(identity.account):undefined;
 if(account&&d.recipients.some(r=>r.address===account))throw Error('A recipient cannot be the payment account itself.');
 return {policy:{id:identity.id,version,kind:0,startAt:BigInt(d.schedule.startAt),endAt:BigInt(d.schedule.endAt),interval:BigInt(d.schedule.intervalSeconds),runCap:BigInt(d.totalPerBatch),periodCap:BigInt(d.totalPerBatch),lifetimeCap:BigInt(d.lifetimeBudget),enabled:false},payees:d.recipients.map(r=>r.address),values:d.recipients.map(r=>BigInt(r.amount))};
}
export function localDateTimeToSeconds(value:string):string {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose a valid date and time.');
 const [year,month,day,hour,minute]=value.split(/[-T:]/).map(Number),date=new Date(year!,month!-1,day,hour,minute);
 if(date.getFullYear()!==year||date.getMonth()!==month!-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute||!Number.isSafeInteger(date.getTime()/1000)||date.getTime()<0)throw Error('Choose a valid date and time.');
 return String(date.getTime()/1000);
}
export const batchDraftStorageKey=(mode:'demo'|'live',owner?:string)=>'studio:batch-draft:v1:'+mode+':'+(owner?.toLowerCase()??'guest');
