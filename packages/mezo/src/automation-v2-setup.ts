import type {Address,Hex} from 'viem';
import type {BatchDraft} from '../../automation/src/studio/batch';
import {batchConfiguration} from './automation-v2-batch';
import {prepareV2OwnerAction,type V2OwnerAction} from './automation-v2-adapter';
export type GroupSetupStep='classify'|'protection'|'configure'|'allocate'|'executor'|'revoke';
export interface GroupReview {step:GroupSetupStep;draftId:string;owner:Address;account:Address;globalBudget:string;amount?:string;executor?:Address;protection?:{committed:string;buffer:string;evidence:Hex;expiresAt:string}}
export function groupSetupTransaction(review:GroupReview,draft:BatchDraft){
 const config=batchConfiguration('live:'+review.owner.toLowerCase(),review.draftId,review.account,draft);
 let action:V2OwnerAction;
 const amount=()=>{if(!review.amount||!/^\d{1,78}$/.test(review.amount)||BigInt(review.amount)<=0n||BigInt(review.amount)>BigInt(draft.lifetimeBudget))throw Error('Group setup amount exceeds the reviewed budget.');return BigInt(review.amount);};
 switch(review.step){
  case 'classify':action={type:'classifyCapital',amount:amount()};break;
  case 'protection':{const p=review.protection;if(!p)throw Error('Cash reserve review is missing.');action={type:'setProtection',committed:BigInt(p.committed),buffer:BigInt(p.buffer),evidence:p.evidence,expiresAt:BigInt(p.expiresAt)};break;}
  case 'configure':action={type:'configure',policy:config.policy,payees:config.payees,values:config.values,explicitlyApprovedEnable:true};break;
  case 'allocate':action={type:'allocate',id:config.id,amount:amount(),fromRevenue:false};break;
  case 'executor':if(!review.executor)throw Error('Payment service address is missing.');action={type:'setExecutor',executor:review.executor,allowed:true};break;
  case 'revoke':action={type:'revoke',id:config.id};break;
  default:throw Error('Unsupported group payment action.');
 }
 return prepareV2OwnerAction({account:review.account,owner:review.owner,globalBudget:BigInt(review.globalBudget)},action);
}
