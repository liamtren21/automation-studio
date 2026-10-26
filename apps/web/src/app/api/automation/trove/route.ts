import {database} from '../../../../../../../packages/db/src/database';
import {rateLimit} from '@/server/automation/rate-limit';
import {NextRequest,NextResponse} from 'next/server';
import {readTroveSnapshot} from '../../../../../../../packages/mezo/src/trove-read';
import {publicClient} from '../../../../../../../packages/mezo/src/network';
import {errorResponse} from '@/server/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{await rateLimit(await database(),'trove:'+(request.headers.get('x-forwarded-for')??'local').split(',')[0],20);const address=request.nextUrl.searchParams.get('address')??'';return NextResponse.json(await readTroveSnapshot(publicClient(),address),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return errorResponse(error);}}
