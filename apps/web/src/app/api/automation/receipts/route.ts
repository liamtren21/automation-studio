import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {workspaceIdentity} from '@/server/auth';
import {readBody,errorResponse} from '@/server/http';
import {createRunShare,readRunShare,receiptCsv} from '@/server/automation/run-receipts';
import {revokeAutomationShare} from '@/server/automation/shares';
import {rateLimit} from '@/server/automation/rate-limit';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'};
export async function GET(req:NextRequest){try{const out=await readRunShare(await database(),req.nextUrl.searchParams.get('token')??'');
 if(out&&req.nextUrl.searchParams.get('format')==='csv')return new NextResponse(receiptCsv(out),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="automation-payment-receipt.csv"'}});
 if(out&&req.nextUrl.searchParams.get('format')==='json')return new NextResponse(JSON.stringify(out,null,2),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="automation-payment-receipt.json"'}});
 return NextResponse.json(out??{error:'Receipt not found or expired.'},{status:out?200:404,headers});}catch{return NextResponse.json({error:'Receipt is temporarily unavailable.'},{status:503,headers});}}
export async function POST(req:NextRequest){try{
 const body=await readBody(req),identity=await workspaceIdentity('live'),db=await database();await rateLimit(db,'run-share:'+identity.id,20);
 if(body.action==='revoke'){if(typeof body.token!=='string')throw new Error('Share token required.');await revokeAutomationShare(db,identity.id,body.token);return NextResponse.json({revoked:true},{headers});}
 if(typeof body.runId!=='string')throw new Error('Choose a submitted payment.');
 return NextResponse.json(await createRunShare(db,identity.id,body.runId,body.consent===true),{headers});
 }catch(error){return errorResponse(error);}}
