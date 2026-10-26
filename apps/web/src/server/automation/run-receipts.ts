import {createHash,randomBytes} from 'node:crypto';
import {decodeEventLog,encodeFunctionData,erc20Abi,type Hex} from 'viem';
import type {Database} from '../../../../../packages/db/src/database';
import {hashPolicy,type StudioPolicy} from '../../../../../packages/automation/src/studio';
import {automationVaultAbi} from '../../../../../packages/mezo/src/automation-abi';
import {officialTestnetMusd,publicClient} from '../../../../../packages/mezo/src/network';
import {verifyAutomationReceipt} from '../../../../../packages/mezo/src/automation-receipt';
import {rateLimit} from './rate-limit';

interface RecordedRun {policy:StudioPolicy;periodIndex:string;txHash:string;nonce:string;executor:string}
interface ReceiptReader {
 getChainId():Promise<number>;getBlockNumber():Promise<bigint>;
 getBlock(input:{blockNumber:bigint}):Promise<{hash:string|null}>;
 getTransaction(input:{hash:Hex}):Promise<{from:string;to:string|null;input:string;value:bigint;nonce:number}>;
 getTransactionReceipt(input:{hash:Hex}):Promise<{status:string;blockHash:string;blockNumber:bigint;logs:readonly{address:string;topics:readonly unknown[];data:string;logIndex?:number|null}[]}>;
}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Re-verifies from chain on every public read; a persisted confirmed label is insufficient. */
export async function verifyPublicRun(run:RecordedRun,reader:ReceiptReader=publicClient()) {
 const p=run.policy;
 const base={chainId:p.chainId,vault:p.vault,token:officialTestnetMusd,recipient:p.recipient,amount:p.amount,policyId:p.policyId,version:p.version,periodIndex:run.periodIndex,policyHash:hashPolicy(p),txHash:run.txHash,checkedAt:new Date().toISOString()};
 let receipt:Awaited<ReturnType<ReceiptReader['getTransactionReceipt']>>,tx:Awaited<ReturnType<ReceiptReader['getTransaction']>>,canonical:string|null,head:bigint;
 try{
  if(await reader.getChainId()!==31611)return {...base,status:'unverified' as const};
  [receipt,tx,head]=await Promise.all([reader.getTransactionReceipt({hash:run.txHash as Hex}),reader.getTransaction({hash:run.txHash as Hex}),reader.getBlockNumber()]);
  canonical=(await reader.getBlock({blockNumber:receipt.blockNumber})).hash;
 }catch{return {...base,status:'unavailable' as const};}
 const confirmations=head>=receipt.blockNumber?head-receipt.blockNumber+1n:0n;
 const mined={...base,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,confirmations:confirmations.toString()};
 try{
  const expectedData=encodeFunctionData({abi:automationVaultAbi,functionName:'executePayout',args:[p.policyId,BigInt(p.version),BigInt(run.periodIndex)]});
  const result=verifyAutomationReceipt({vault:p.vault,recipient:p.recipient,executor:run.executor,token:officialTestnetMusd,policyId:p.policyId,version:p.version,periodIndex:run.periodIndex,amount:p.amount,policyHash:base.policyHash,nonce:Number(run.nonce),expectedData,tx,receipt,canonicalBlockHash:canonical});
  const status=result==='pending'||confirmations<2n?'pending':result;
  if(status!=='confirmed')return {...mined,status};
  let payoutLogIndex:number|null=null,transferLogIndex:number|null=null;
  for(const log of receipt.logs){
   if(log.logIndex===null||log.logIndex===undefined||!Number.isSafeInteger(log.logIndex)||log.logIndex<0)continue;
   if(log.address.toLowerCase()===p.vault.toLowerCase())try{const e=decodeEventLog({abi:automationVaultAbi,eventName:'PayoutExecuted',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(e.args.policyId===p.policyId&&e.args.version===BigInt(p.version)&&e.args.periodIndex===BigInt(run.periodIndex))payoutLogIndex=log.logIndex;}catch{}
   if(log.address.toLowerCase()===officialTestnetMusd.toLowerCase())try{const e=decodeEventLog({abi:erc20Abi,eventName:'Transfer',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(e.args.from.toLowerCase()===p.vault.toLowerCase()&&e.args.to.toLowerCase()===p.recipient.toLowerCase()&&e.args.value===BigInt(p.amount))transferLogIndex=log.logIndex;}catch{}
  }
  if(payoutLogIndex===null||transferLogIndex===null)return {...mined,status:'unverified' as const};
  return {...mined,status,payoutLogIndex,transferLogIndex};
 }catch{return {...mined,status:'unverified' as const};}
}
export function receiptCsv(receipt:Record<string,unknown>){
 const cell=(value:unknown)=>{let s=String(value??'');if(/^[=+\-@\t\r\n]/.test(s.trimStart())||/^\d{16,}$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const entries=Object.entries(receipt);return entries.map(([k])=>cell(k)).join(',')+'\r\n'+entries.map(([,v])=>cell(v)).join(',')+'\r\n';
}
async function recordedRun(db:Database,workspace:string,id:string):Promise<RecordedRun|null> {
 const row=(await db.query<{policy:StudioPolicy;period_index:string;nonce:string;intent:{executor?:string};tx_hash:string}>(`SELECT p.body AS policy,r.period_index::text,a.nonce::text,a.intent,a.tx_hash
 FROM automation_runs r JOIN automation_policies p ON p.workspace_id=r.workspace_id AND p.chain_id=r.chain_id AND p.vault=r.vault AND p.policy_id=r.policy_id AND p.version=r.version
 JOIN automation_attempts a ON a.run_id=r.id AND a.workspace_id=r.workspace_id
 WHERE r.workspace_id=$1 AND r.id=$2 AND r.chain_id=31611 ORDER BY a.created_at DESC LIMIT 1`,[workspace,id])).rows[0];
 if(!row||!/^0x[0-9a-f]{64}$/i.test(row.tx_hash)||!/^0x[0-9a-f]{40}$/i.test(row.intent.executor??''))return null;
 return {policy:row.policy,periodIndex:row.period_index,nonce:row.nonce,executor:row.intent.executor!,txHash:row.tx_hash};
}
export async function createRunShare(db:Database,workspace:string,runId:string,consent:boolean,now=Math.floor(Date.now()/1000)) {
 if(!consent)throw new Error('Confirm the public payment details before sharing.');
 if(!workspace.startsWith('live:'))throw new Error('Only a submitted Testnet run can have a public payment receipt.');
 const run=await recordedRun(db,workspace,runId);if(!run)throw new Error('Submitted payment not found in this workspace.');
 const token=randomBytes(32).toString('hex'),expiresAt=now+7*86400;
 await db.query('INSERT INTO automation_share_tokens(token_hash,workspace_id,chain_id,vault,body,expires_at) VALUES($1,$2,31611,$3,$4::jsonb,$5)',[digest(token),workspace,run.policy.vault.toLowerCase(),JSON.stringify({kind:'run',runId}),String(expiresAt)]);
 return {token,path:'/receipts/'+token,expiresAt};
}
export async function readRunShare(db:Database,token:string,reader:ReceiptReader=publicClient(),now=Math.floor(Date.now()/1000)) {
 if(!/^[0-9a-f]{64}$/.test(token))return null;
 await rateLimit(db,'run-receipt:'+digest(token),30,now);
 const share=(await db.query<{workspace_id:string;body:{kind?:string;runId?:string}}>('SELECT workspace_id,body FROM automation_share_tokens WHERE token_hash=$1 AND revoked=false AND expires_at>$2',[digest(token),String(now)])).rows[0];
 if(share?.body.kind!=='run'||!share.body.runId)return null;
 const run=await recordedRun(db,share.workspace_id,share.body.runId);return run?verifyPublicRun(run,reader):null;
}
