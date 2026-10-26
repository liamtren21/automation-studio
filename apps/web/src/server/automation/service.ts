import {currentProtection} from './protection';
import {randomBytes} from 'node:crypto';
import {keccak256,toHex,type Address,type Hex} from 'viem';
import type {Database,Sql} from '../../../../../packages/db/src/database';
import {createAutomationPolicy,listAutomationPolicies,getAutomationPolicy,type AutomationPolicyRecord} from '../../../../../packages/db/src/automation';
import {decideStudio,forecastStudio,hashPolicy,integer,periodAt,type StudioPolicy,type StudioSnapshot} from '../../../../../packages/automation/src/studio';
import {parseMusd} from '../../../../../packages/domain/src/money';
import {officialTestnetMusd} from '../../../../../packages/mezo/src/network';

export interface StudioActivity {id:string;policyId:string;name:string;at:string;state:string;reason:string;amount:string;txHash?:string}
export interface StudioAccount {
 mode:'demo'|'live';vault:Address;owner:Address;token:Address;globalBudget:string;balance:string;
 committedBills:string;buffer:string;globalSpent:string;protectionSourceHash:Hex;protectionExpiresAt:string;now:string;
 allocations:Record<string,string>;spent:Record<string,string>;consumed:Record<string,string[]>;labels:Record<string,string>;activity:StudioActivity[];
 deploymentTx?:Hex;
 worker?:{at:string;executor:string};
}
export interface StudioDraftInput {name:string;recipient:string;amount:string;budget:string;startAt:string;endAt:string;intervalSeconds:string;priority:string}
export async function loadStudioAccount(db:Sql,workspaceId:string):Promise<StudioAccount|null> {
 return (await db.query<{body:StudioAccount}>('SELECT body FROM automation_accounts WHERE workspace_id=$1',[workspaceId])).rows[0]?.body??null;
}
export async function saveStudioAccount(db:Sql,workspaceId:string,account:StudioAccount) {
 await db.query('UPDATE automation_accounts SET body=$2::jsonb WHERE workspace_id=$1',[workspaceId,JSON.stringify(account)]);
}
export async function ensureDemoAccount(db:Database,workspaceId:string,now=Math.floor(Date.now()/1000)) {
 if(!workspaceId.startsWith('demo:'))throw new Error('A demo workspace is required.');
 await db.query('INSERT INTO automation_cash_protection(workspace_id,committed_amount,cushion_amount) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[workspaceId,parseMusd('10').toString(),parseMusd('10').toString()]);
 const demoSource=await currentProtection(db,workspaceId);
 const digest=keccak256(toHex(workspaceId));
 const account:StudioAccount={mode:'demo',vault:('0x'+digest.slice(-40)) as Address,owner:'0x1111111111111111111111111111111111111111',token:officialTestnetMusd,
  globalBudget:parseMusd('30').toString(),balance:parseMusd('50').toString(),committedBills:parseMusd('10').toString(),buffer:parseMusd('10').toString(),globalSpent:'0',
  protectionSourceHash:demoSource.sourceHash,protectionExpiresAt:String(now+366*86400),now:String(now),allocations:{},spent:{},consumed:{},labels:{},activity:[]};
 await db.query('INSERT INTO automation_accounts(workspace_id,mode,chain_id,vault,body) VALUES($1,\'demo\',31611,$2,$3::jsonb) ON CONFLICT(workspace_id) DO NOTHING',[workspaceId,account.vault.toLowerCase(),JSON.stringify(account)]);
 return (await loadStudioAccount(db,workspaceId))!;
}
export function snapshotFor(account:StudioAccount,policy:StudioPolicy):StudioSnapshot {
 const id=policy.policyId.toLowerCase(),period=periodAt(policy,account.now);
 const allocation=account.allocations[id]??'0',total=Object.values(account.allocations).reduce((n,v)=>n+integer(v),0n);
 const consumed=account.consumed[id]??[];
 return {now:account.now,blockNumber:'0',balance:account.balance,committedBills:account.committedBills,buffer:account.buffer,protectionExpiresAt:account.protectionExpiresAt,
  protectionSourceHash:account.protectionSourceHash,currentSourceHash:account.protectionSourceHash,globalBudget:account.globalBudget,globalSpent:account.globalSpent,allocation,
  otherAllocations:(total-integer(allocation)).toString(),lifetimeSpent:account.spent[id]??'0',periodSpent:period!==null&&consumed.includes(period)?policy.amount:'0',consumedPeriods:consumed};
}
export function latestRules(records:AutomationPolicyRecord[]) {
 const map=new Map<string,AutomationPolicyRecord>();
 for(const row of records){const key=`${row.policy.chainId}:${row.policy.vault.toLowerCase()}:${row.policy.policyId.toLowerCase()}`;const old=map.get(key);if(!old||BigInt(old.policy.version)<BigInt(row.policy.version))map.set(key,row);}
 return [...map.values()].sort((a,b)=>Number(BigInt(a.policy.priority)-BigInt(b.policy.priority))||a.policy.policyId.localeCompare(b.policy.policyId));
}
export async function policyHistory(db:Sql,workspaceId:string) {
 const rows=(await db.query<{body:StudioPolicy;config_hash:string;display_name:string;status:string;created_at:string}>('SELECT body,config_hash,display_name,status,created_at FROM automation_policies WHERE workspace_id=$1 ORDER BY version',[workspaceId])).rows;
 const evidence=(await db.query<{policy_id:string;version:string;config_hash:string;tx_hash:string;block_number:string;block_hash:string;effective_at:string;verified_at:string}>('SELECT policy_id,version::text,config_hash,tx_hash,block_number::text,block_hash,effective_at::text,verified_at::text FROM studio_configuration_evidence WHERE workspace_id=$1 ORDER BY verified_at DESC',[workspaceId])).rows;
 return rows.map(row=>{const proof=evidence.find(e=>e.policy_id.toLowerCase()===row.body.policyId.toLowerCase()&&e.version===row.body.version&&e.config_hash===row.config_hash);return {policy:row.body,version:row.body.version,configHash:row.config_hash,name:row.display_name||'Scheduled payment',status:row.status,createdAt:new Date(row.created_at).toISOString(),activation:proof?{txHash:proof.tx_hash,blockNumber:proof.block_number,blockHash:proof.block_hash,effectiveAt:proof.effective_at,verifiedAt:proof.verified_at}:null};});
}
export async function createStudioDraft(db:Database,workspaceId:string,input:StudioDraftInput,revision?:{policyId:Hex;version:string}) {
 const a=await loadStudioAccount(db,workspaceId);if(!a)throw new Error('Set up an automation account first.');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw new Error('Enter a payment name, up to 80 characters.');
 const policy:StudioPolicy={chainId:'31611',vault:a.vault,policyId:revision?.policyId??('0x'+randomBytes(32).toString('hex')) as Hex,version:revision?.version??'1',recipient:input.recipient as Address,
  amount:parseMusd(input.amount).toString(),startAt:input.startAt,endAt:input.endAt,intervalSeconds:input.intervalSeconds,perRunCap:parseMusd(input.amount).toString(),
  perPeriodCap:parseMusd(input.amount).toString(),lifetimeCap:parseMusd(input.budget).toString(),priority:input.priority,enabled:true};
 hashPolicy(policy);
 for(const t of [policy.startAt,policy.endAt])if(integer(t)>253402300799n)throw new Error('Choose a schedule date before year 10000.');
 if(integer(policy.priority)>1000n)throw new Error('Payment priority must be between 0 and 1000.');
 if(policy.recipient.toLowerCase()===a.vault.toLowerCase())throw new Error('Choose a recipient outside this vault.');
 if(integer(policy.lifetimeCap)<integer(policy.amount))throw new Error('Total budget must cover at least one payment.');
 const record=await createAutomationPolicy(db,workspaceId,policy);
 await db.query('UPDATE automation_policies SET display_name=$4 WHERE workspace_id=$1 AND policy_id=$2 AND version=$3',[workspaceId,policy.policyId,policy.version,input.name.trim()]);
 return record;
}
export async function reviseStudioDraft(db:Database,workspaceId:string,policyId:string,input:StudioDraftInput) {
 const account=await loadStudioAccount(db,workspaceId);if(!account)throw new Error('Automation account not found.');
 const old=await getAutomationPolicy(db,workspaceId,{chainId:'31611',vault:account.vault,policyId});if(!old)throw new Error('Payment not found.');
 if(input.startAt!==old.policy.startAt||input.intervalSeconds!==old.policy.intervalSeconds)throw new Error('The schedule grid cannot change for an existing payment. Create a new rule for a different start or interval.');
 return createStudioDraft(db,workspaceId,input,{policyId:old.policy.policyId,version:(BigInt(old.policy.version)+1n).toString()});
}
export async function loadStudioView(db:Database,workspaceId:string) {
 const source=await currentProtection(db,workspaceId);
 const account=await loadStudioAccount(db,workspaceId),records=latestRules(await listAutomationPolicies(db,workspaceId));
 const history=await policyHistory(db,workspaceId);
 const rules=account?records.filter(r=>r.policy.vault.toLowerCase()===account.vault.toLowerCase()).map(r=>{
  const snapshot={...snapshotFor(account,r.policy),currentSourceHash:source.sourceHash},effective={...r.policy,enabled:r.policy.enabled&&r.status==='active'};
  const start=integer(r.policy.startAt),step=integer(r.policy.intervalSeconds),now=integer(snapshot.now),first=now<=start?start:start+((now-start)/step+1n)*step;
  const times=Array.from({length:7},(_,i)=>(first+BigInt(i)*step).toString());
  const hypothetical=r.status==='draft'?{...snapshot,allocation:r.policy.lifetimeCap}:snapshot;
  const revisions=history.filter(h=>h.policy.policyId.toLowerCase()===r.policy.policyId.toLowerCase()&&h.policy.vault.toLowerCase()===r.policy.vault.toLowerCase());
  return {...r,name:revisions.find(h=>h.version===r.policy.version)?.name??'Scheduled payment',revisions,decision:decideStudio(snapshot,effective),snapshot,forecast:forecastStudio(hypothetical,{...r.policy,enabled:r.status!=='revoked'},times)};
 }):[];
 return {mode:account?.mode??null,configured:!!account,account,rules,activity:account?.activity??[],notice:account?.mode==='demo'?'Sample automation account. No wallet request or blockchain transaction is sent.':'Mezo Testnet. Execution uses only the separate automation vault.'};
}
export async function activateDemoPolicy(db:Database,workspaceId:string,policyId:string,budgetMusd:string) {
 const budget=parseMusd(budgetMusd);
 await db.transaction(async q=>{
  await q.query('SELECT workspace_id FROM automation_accounts WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);
  const a=await loadStudioAccount(q,workspaceId);if(a?.mode!=='demo')throw new Error('This action only runs a demo.');
  const row=(await q.query<{body:StudioPolicy;status:string}>('SELECT body,status FROM automation_policies WHERE workspace_id=$1 AND policy_id=$2 ORDER BY version DESC LIMIT 1',[workspaceId,policyId])).rows[0];
  if(!row||row.body.vault.toLowerCase()!==a.vault.toLowerCase())throw new Error('Rule not found.');
  if(row.status==='active')return;
  if(row.status!=='draft')throw new Error('Create and review a new policy version before reactivating.');
  const id=policyId.toLowerCase(),total=Object.entries(a.allocations).filter(([key])=>key!==id).reduce((n,[,v])=>n+integer(v),0n);
  if(budget===0n||budget+integer(a.spent[id]??'0')>integer(row.body.lifetimeCap)||total+budget+integer(a.globalSpent)>integer(a.globalBudget))throw new Error('Shared budget is not sufficient.');
  if(total+budget+integer(a.committedBills)+integer(a.buffer)>integer(a.balance))throw new Error('Cash reserved for bills and your cushion cannot be allocated.');
  a.allocations[id]=budget.toString();await saveStudioAccount(q,workspaceId,a);
  await q.query("UPDATE automation_policies SET status='active' WHERE workspace_id=$1 AND policy_id=$2 AND version=$3",[workspaceId,policyId,row.body.version]);
 });return loadStudioView(db,workspaceId);
}
export async function stopDemoPolicy(db:Database,workspaceId:string,policyId:string) {
 const a=await loadStudioAccount(db,workspaceId);if(a?.mode!=='demo')throw new Error('This action only runs a demo.');
 await db.query("UPDATE automation_policies SET status='revoked' WHERE workspace_id=$1 AND policy_id=$2",[workspaceId,policyId]);return loadStudioView(db,workspaceId);
}
export async function runDemoPeriod(db:Database,workspaceId:string,at:number) {
 if(!Number.isSafeInteger(at)||at<0)throw new Error('Invalid sample time.');
 await db.transaction(async q=>{
  await q.query('SELECT workspace_id FROM automation_accounts WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);
  const a=await loadStudioAccount(q,workspaceId);if(a?.mode!=='demo')throw new Error('Only a demo can be advanced without wallet signatures.');
  if(BigInt(at)<integer(a.now))throw new Error('Sample time cannot move backwards.');a.now=String(at);
  const rows=(await q.query<{body:StudioPolicy;status:string;display_name:string}>('SELECT body,status,display_name FROM automation_policies WHERE workspace_id=$1',[workspaceId])).rows;
  const latest=latestRules(rows.map(r=>({workspaceId,policy:r.body,status:r.status,configHash:hashPolicy(r.body)})));
  for(const r of latest){if(r.status!=='active')continue;const p=r.policy,s={...snapshotFor(a,p),currentSourceHash:(await currentProtection(q,workspaceId)).sourceHash},d=decideStudio(s,p),id=p.policyId.toLowerCase();
   const key=`${id}:${p.version}:${d.periodIndex??at}`;
   if(d.allowed){const amount=integer(p.amount);a.balance=(integer(a.balance)-amount).toString();a.globalSpent=(integer(a.globalSpent)+amount).toString();a.allocations[id]=(integer(a.allocations[id])-amount).toString();a.spent[id]=(integer(a.spent[id]??'0')+amount).toString();a.consumed[id]=[...(a.consumed[id]??[]),d.periodIndex!];}
   if(!a.activity.some(e=>e.id===key&&e.reason===d.reasonCode))a.activity.unshift({id:key,policyId:id,name:rows.find(row=>row.body.policyId===p.policyId)?.display_name??'Payment',at:String(at),state:d.allowed?'simulated':'blocked',reason:d.reasonCode,amount:p.amount});
  }
  a.activity=a.activity.slice(0,100);await saveStudioAccount(q,workspaceId,a);
 });return loadStudioView(db,workspaceId);
}

export async function updateDemoProtection(db:Database,workspaceId:string){return db.transaction(async q=>{
 await q.query('SELECT workspace_id FROM automation_accounts WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);const a=await loadStudioAccount(q,workspaceId);if(a?.mode!=='demo')throw new Error('Demo only');
 const source=await currentProtection(q,workspaceId),allocated=Object.values(a.allocations).reduce((n,v)=>n+BigInt(v),0n);
 if(BigInt(source.protectedFloor)+allocated>BigInt(a.balance))throw new Error('Release allocations or add sample cash before applying the new protection floor.');
 a.committedBills=source.committedBills;a.buffer=source.buffer;a.protectionSourceHash=source.sourceHash;a.protectionExpiresAt=(BigInt(a.now)+86400n*366n).toString();await saveStudioAccount(q,workspaceId,a);return loadStudioView(q as Database,workspaceId);
 });}
export async function reallocateDemo(db:Database,workspaceId:string,policyId:string,target:string){await db.transaction(async q=>{
 await q.query('SELECT workspace_id FROM automation_accounts WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);const a=await loadStudioAccount(q,workspaceId);if(a?.mode!=='demo')throw new Error('Demo only');
 const row=(await q.query<{body:StudioPolicy}>('SELECT body FROM automation_policies WHERE workspace_id=$1 AND policy_id=$2 ORDER BY version DESC LIMIT 1',[workspaceId,policyId])).rows[0];if(!row)throw new Error('Unknown rule');
 const amount=parseMusd(target),id=policyId.toLowerCase(),existing=BigInt(a.allocations[id]??'0');if(amount>existing&&(await currentProtection(q,workspaceId)).sourceHash!==a.protectionSourceHash)throw new Error('Refresh cash protection before increasing allocation.');
 const other=Object.entries(a.allocations).filter(([key])=>key!==id).reduce((n,[,v])=>n+BigInt(v),0n);
 if(amount+BigInt(a.spent[id]??'0')>BigInt(row.body.lifetimeCap)||other+amount+BigInt(a.globalSpent)>BigInt(a.globalBudget)||other+amount+BigInt(a.committedBills)+BigInt(a.buffer)>BigInt(a.balance))throw new Error('Allocation exceeds funded cash or policy limits.');
 a.allocations[id]=amount.toString();await saveStudioAccount(q,workspaceId,a);
 });return loadStudioView(db,workspaceId);}
