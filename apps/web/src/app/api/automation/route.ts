import {proposePriorityAllocation} from '../../../../../../packages/automation/src/studio/allocation';
import {listOperations} from '@/server/automation/operations';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../packages/db/src/database';


import {automationDeploymentData} from '../../../../../../packages/mezo/src/automation-payload';
import {officialTestnetMusd} from '../../../../../../packages/mezo/src/network';
import {workspaceIdentity} from '@/server/auth';
import {readBody,modeOf,errorResponse} from '@/server/http';
import {reallocateDemo,updateDemoProtection,ensureDemoAccount,createStudioDraft,reviseStudioDraft,loadStudioView,activateDemoPolicy,runDemoPeriod,stopDemoPolicy,type StudioDraftInput} from '@/server/automation/service';
import {loadLiveStudioView,prepareStudioOperation,bindStudioDeployment,verifyStudioConfirmation} from '@/server/automation/live';
import type {Address,Hex} from 'viem';
import {forecastPortfolio} from '../../../../../../packages/automation/src/studio/portfolio';
import type {StudioPolicy} from '../../../../../../packages/automation/src/studio';
import {parseMusd} from '../../../../../../packages/domain/src/money';
import {currentProtection,saveProtectionSettings} from '@/server/automation/protection';
import {recordConfigurationEvidence} from '@/server/automation/configuration-evidence';
import {executorConfiguration} from '@/server/automation/runtime-health';
import type {StudioAccount} from '@/server/automation/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function context(mode:'demo'|'live') {const identity=await workspaceIdentity(mode),db=await database();await db.query('INSERT INTO workspaces(id,mode,balance,buffer) VALUES($1,$2,0,0) ON CONFLICT DO NOTHING',[identity.id,mode]);if(mode==='demo')await ensureDemoAccount(db,identity.id);return{identity,db};}
async function decorate<T extends {account:StudioAccount|null;rules:{status:string;policy:StudioPolicy}[]}>(db:Awaited<ReturnType<typeof database>>,id:string,view:T,extraExpense='0',expenseDay=0,extra:{expectedIncome?:string;incomeDay?:number;incomeDelayDays?:number;repaymentExpense?:string;repaymentDay?:number}={}){
 const expense=parseMusd(extraExpense).toString();
 const scheduler=(await db.query<{last_started:string|null;last_finished:string|null;status:string;body:unknown}>("SELECT last_started::text,last_finished::text,status,body FROM studio_scheduler WHERE id='main'")).rows[0]??null;
 const operations=await listOperations(db,id);
 return {...view,scheduler,executorAddress:executorConfiguration(process.env.STUDIO_EXECUTOR_ADDRESS,process.env.STUDIO_EXECUTOR_PRIVATE_KEY).address??null,operations,allocationProposal:view.account?proposePriorityAllocation(view.account,view.rules.map(r=>({...r.policy,enabled:!['revoked','expired'].includes(r.status)}))):null,source:await currentProtection(db,id),vendors:[],portfolio:view.account?forecastPortfolio(view.account,view.rules.filter(r=>r.status==='active').map(r=>r.policy),30,{extraExpense:expense,expenseDay,...extra}):[],scenario:{extraExpense,expenseDay},forecastNotice:'Only existing automation funds and active rules are included. Protection expiry is enforced; future receipts and future approvals are not assumed.'};
}
export async function GET(req:NextRequest){try{const mode=modeOf(req.nextUrl.searchParams.get('mode')),{db,identity}=await context(mode);const view=mode==='demo'?await loadStudioView(db,identity.id):await loadLiveStudioView(db,identity.id,identity.owner as Address);return NextResponse.json({...await decorate(db,identity.id,view,req.nextUrl.searchParams.get('extraExpense')??'0',Number(req.nextUrl.searchParams.get('expenseDay')??0),{expectedIncome:parseMusd(req.nextUrl.searchParams.get('expectedIncome')??'0').toString(),incomeDay:Number(req.nextUrl.searchParams.get('incomeDay')??0),incomeDelayDays:Number(req.nextUrl.searchParams.get('incomeDelayDays')??0),repaymentExpense:parseMusd(req.nextUrl.searchParams.get('repaymentExpense')??'0').toString(),repaymentDay:Number(req.nextUrl.searchParams.get('repaymentDay')??0)}),owner:identity.owner,role:identity.role},{headers});}catch(e){return errorResponse(e);}}
export async function POST(req:NextRequest){try{
 const b=await readBody(req),mode=modeOf(b.mode),{db,identity}=await context(mode);
 const id=typeof b.policyId==='string'?b.policyId:'';
 let out:unknown;
 switch(b.action){
  case 'demo_protection':if(mode!=='demo')throw new Error('Demo only');out=await updateDemoProtection(db,identity.id);break;
  case 'demo_reallocate':if(mode!=='demo')throw new Error('Demo only');out=await reallocateDemo(db,identity.id,id,String(b.target));break;
  case 'protection_settings':await saveProtectionSettings(db,identity.id,{committedBills:b.committedBills,cashCushion:b.cashCushion});out=mode==='demo'?await loadStudioView(db,identity.id):await loadLiveStudioView(db,identity.id,identity.owner as Address);break;
  case 'create':out=await createStudioDraft(db,identity.id,b.input as StudioDraftInput);break;
  case 'revise':out=await reviseStudioDraft(db,identity.id,id,b.input as StudioDraftInput);break;
  case 'preview':out=mode==='demo'?await loadStudioView(db,identity.id):await loadLiveStudioView(db,identity.id,identity.owner as Address);break;
  case 'demo_activate':if(mode!=='demo')throw new Error('Demo action is unavailable in live mode.');out=await activateDemoPolicy(db,identity.id,id,String(b.budget??''));break;
  case 'demo_stop':if(mode!=='demo')throw new Error('Demo action is unavailable in live mode.');out=await stopDemoPolicy(db,identity.id,id);break;
  case 'demo_run':if(mode!=='demo')throw new Error('Demo action is unavailable in live mode.');out=await runDemoPeriod(db,identity.id,b.at as number);break;
  case 'prepare':if(mode!=='live')throw new Error('Choose Mezo Testnet to prepare a wallet request.');out=await prepareStudioOperation(db,identity.id,identity.owner as Address,{operation:String(b.operation),policyId:id||undefined,amount:typeof b.amount==='string'?b.amount:undefined,executor:typeof b.executor==='string'?b.executor:undefined,allowed:b.allowed as boolean|undefined,repaymentHandoffId:typeof b.repaymentHandoffId==='string'?b.repaymentHandoffId:undefined});break;
  case 'prepare_deployment':if(mode!=='live')throw new Error('Choose Mezo Testnet to deploy.');out={transaction:{data:automationDeploymentData(identity.owner as Address,String(b.budget)),value:'0x0',chainId:31611},review:{operation:'deploy',owner:identity.owner,budget:b.budget,token:officialTestnetMusd},expiresAt:Date.now()+60000};break;
  case 'bind_deployment':if(mode!=='live'||typeof b.txHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(b.txHash))throw new Error('A deployment transaction hash is required.');out=await bindStudioDeployment(db,identity.id,identity.owner as Address,b.txHash as Hex);break;
  case 'sync':if(mode==='live'&&b.txHash){if(typeof b.txHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(b.txHash))throw new Error('Invalid transaction hash.');const proof=await verifyStudioConfirmation(identity.owner as Address,b.txHash as Hex,b.expectedTransaction as {to?:string;data?:string});await recordConfigurationEvidence(db,identity.id,proof);}out=mode==='demo'?await loadStudioView(db,identity.id):await loadLiveStudioView(db,identity.id,identity.owner as Address);break;
  default:throw new Error('Unknown automation action.');
 }
 if(out&&typeof out==='object'&&'account' in out)out=await decorate(db,identity.id,out as {account:StudioAccount|null;rules:{status:string;policy:StudioPolicy}[]});
 return NextResponse.json(out,{headers});
}catch(e){return errorResponse(e);}}
