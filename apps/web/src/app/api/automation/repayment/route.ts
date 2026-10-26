import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {workspaceIdentity} from '@/server/auth';
import {readBody,errorResponse} from '@/server/http';
import {listRepaymentHandoffs,startRepaymentHandoff,linkRepaymentWithdrawal,prepareHandoffRepayment,registerHandoffRepayment,reconcileHandoff,cancelRepaymentHandoff} from '@/server/automation/repayment';
import type {Address} from 'viem';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{const identity=await workspaceIdentity('live');return NextResponse.json({handoffs:await listRepaymentHandoffs(await database(),identity.id)},{headers});}catch(e){return errorResponse(e);}}
export async function POST(req:NextRequest){try{const b=await readBody(req),identity=await workspaceIdentity('live'),db=await database(),owner=identity.owner as Address,id=String(b.id??'');let result:unknown;
 switch(b.action){case 'start':result=await startRepaymentHandoff(db,identity.id,owner,String(b.amount??''));break;case 'cancel':result=await cancelRepaymentHandoff(db,identity.id,owner,id);break;case 'link_withdraw':result=await linkRepaymentWithdrawal(db,identity.id,owner,id,String(b.txHash??''));break;case 'prepare':result=await prepareHandoffRepayment(db,identity.id,owner,id);break;case 'submit':result=await registerHandoffRepayment(db,identity.id,owner,id,String(b.txHash??''));break;case 'reconcile':result=await reconcileHandoff(db,identity.id,owner,id);break;default:throw new Error('Unknown owner repayment action.');}
 return NextResponse.json(result,{headers});}catch(e){return errorResponse(e);}}
