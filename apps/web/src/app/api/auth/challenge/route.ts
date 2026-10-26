import { NextRequest,NextResponse } from "next/server";
import {challenge} from "@/server/auth";import {errorResponse} from "@/server/http";
import{requestOrigin}from"@/server/origin";
export const runtime="nodejs";
export async function GET(req:NextRequest){try{return NextResponse.json(await challenge(req.nextUrl.searchParams.get("address")||"",requestOrigin(req)),{headers:{"Cache-Control":"no-store"}});}catch(e){return errorResponse(e);}}
