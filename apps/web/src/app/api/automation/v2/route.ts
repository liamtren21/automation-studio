import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {workspaceIdentity} from '@/server/auth';
import {readBody,errorResponse,modeOf} from '@/server/http';
import {rateLimit} from '@/server/automation/rate-limit';
import {listBatchDrafts,saveBatchDraft,deleteBatchDraft} from '@/server/automation/batch-drafts';
import {getV2Account,prepareV2Deployment,bindV2Deployment} from '@/server/automation/v2-account';
import {prepareV2Funding,confirmV2Funding} from '@/server/automation/v2-funding';
import {publicBatchStatus,prepareBatchStep,confirmBatchStep,finishBatchSetup} from '@/server/automation/v2-activation';
import type {Address,Hex} from 'viem';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
async function context(mode:'demo'|'live'){
 const identity=await workspaceIdentity(mode),db=await database();
 await db.query('INSERT INTO workspaces(id,mode,balance,buffer) VALUES($1,$2,0,0) ON CONFLICT DO NOTHING',[identity.id,mode]);
 return {db,identity};
}
export async function GET(req:NextRequest){try{
 const mode=modeOf(req.nextUrl.searchParams.get('mode')),{db,identity}=await context(mode);
 const draftId=req.nextUrl.searchParams.get('draftId');
 if(draftId){if(mode!=='live')throw Error('Group setup status is available on Testnet.');return NextResponse.json(await publicBatchStatus(db,identity.id,draftId),{headers});}
 return NextResponse.json({drafts:await listBatchDrafts(db,identity.id),account:mode==='live'?await getV2Account(db,identity.id):null,capabilities:{deploymentEnabled:mode==='live'&&process.env.STUDIO_V2_BATCH_DEPLOYMENT==='true',automaticPaymentsEnabled:false}},{headers});
}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{
 const body=await readBody(req),mode=modeOf(body.mode),{db,identity}=await context(mode);await rateLimit(db,'batch-draft:'+identity.id,30);
 if(body.action==='save_draft')return NextResponse.json(await saveBatchDraft(db,identity.id,body.draft),{headers});
 if(body.action==='delete_draft'&&typeof body.id==='string'){await deleteBatchDraft(db,identity.id,body.id);return NextResponse.json({deleted:true},{headers});}
 if(mode!=='live'||!identity.owner)throw new Error('Use your owner wallet on Mezo Testnet for account setup.');
 if(body.action==='prepare_step'&&typeof body.draftId==='string')return NextResponse.json(await prepareBatchStep(db,identity.id,identity.owner as Address,body.draftId,body.stop===true),{headers});
 if(body.action==='confirm_step'&&typeof body.reviewId==='string'&&typeof body.txHash==='string')return NextResponse.json(await confirmBatchStep(db,identity.id,identity.owner as Address,body.reviewId,body.txHash as Hex),{headers});
 if(body.action==='finish_setup'&&typeof body.draftId==='string')return NextResponse.json(await finishBatchSetup(db,identity.id,identity.owner as Address,body.draftId),{headers});
 if(body.action==='prepare_funding'&&typeof body.draftId==='string')return NextResponse.json(await prepareV2Funding(db,identity.id,identity.owner as Address,body.draftId),{headers});
 if(body.action==='confirm_funding'&&typeof body.draftId==='string'&&typeof body.txHash==='string')return NextResponse.json(await confirmV2Funding(db,identity.id,identity.owner as Address,body.draftId,body.txHash as Hex),{headers});
 if(body.action==='prepare_account'){
  if(await getV2Account(db,identity.id))throw new Error('Your group payment account is already set up.');
  return NextResponse.json(await prepareV2Deployment(identity.owner as Address,String(body.globalBudget??'')),{headers});
 }
 if(body.action==='bind_account'&&typeof body.txHash==='string'&&/^0x[0-9a-f]{64}$/i.test(body.txHash))return NextResponse.json(await bindV2Deployment(db,identity.id,identity.owner as Address,body.txHash as Hex,String(body.globalBudget??'')),{headers});
 throw new Error('This group payment action is not available.');
}catch(error){return errorResponse(error);}}
