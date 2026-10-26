import {NextResponse} from 'next/server';import {sessionAddress} from '@/server/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({address:await sessionAddress()},{headers:{'Cache-Control':'private, no-store'}});}
