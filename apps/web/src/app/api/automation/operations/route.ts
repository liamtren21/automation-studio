import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {workspaceIdentity} from '@/server/auth';
import {readBody,modeOf,errorResponse} from '@/server/http';
import {listOperations,mutateOperation} from '@/server/automation/operations';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function context(mode:'demo'|'live'){const identity=await workspaceIdentity(mode),db=await database();await db.query('INSERT INTO workspaces(id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING',[identity.id,mode]);return {db,identity};}
export async function GET(req:NextRequest){try{const {db,identity}=await context(modeOf(req.nextUrl.searchParams.get('mode')));return NextResponse.json(await listOperations(db,identity.id),{headers});}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{const body=await readBody(req),{db,identity}=await context(modeOf(body.mode));if(identity.role!=='owner')throw new Error('Only the owner can change operations.');return NextResponse.json(await mutateOperation(db,identity.id,body),{headers});}catch(error){return errorResponse(error);}}
