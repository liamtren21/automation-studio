
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { database } from "../../../../packages/db/src/database";
import { getAddress, isAddress, verifyMessage } from "viem";
import { createSignInMessage, validateSignInMessage } from "../lib/sign-in-message";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export async function challenge(address:string,originOverride?:string){
 if(!isAddress(address))throw new Error("Invalid wallet address.");
 const a=getAddress(address),nonce=randomBytes(20).toString("hex"),now=Date.now(),origin=originOverride||process.env.STUDIO_ORIGIN||"http://localhost:3211";
 const message=createSignInMessage(a,origin,nonce,new Date(now));
 const db=await database();await db.query("INSERT INTO challenges(id,address,message,expires_at) VALUES($1,$2,$3,$4)",[nonce,a.toLowerCase(),message,now+300000]);return {message};
}
export async function verifySession(address:string,signature:string,message:string,origin:string){
 if(!isAddress(address)||typeof signature!=="string"||typeof message!=="string"||message.length>2000)throw new Error("Invalid sign-in request.");
 const a=getAddress(address),parsed=validateSignInMessage(message,a,origin),db=await database();
 const found=await db.query<{id:string;expires_at:string;used:boolean}>("SELECT id,expires_at,used FROM challenges WHERE address=$1 AND message=$2 ORDER BY expires_at DESC LIMIT 1",[a.toLowerCase(),message]);
 const row=found.rows[0];if(!row||row.used||Number(row.expires_at)<=Date.now()||parsed.nonce!==row.id||parsed.expirationTime?.getTime()!==Number(row.expires_at))throw new Error("Sign-in request expired or already used.");
 if(!await verifyMessage({address:a,message,signature:signature as `0x${string}`}))throw new Error("Wallet signature did not match.");
 const token=randomBytes(32).toString("hex");
 await db.transaction(async q=>{const result=await q.query("UPDATE challenges SET used=true WHERE id=$1 AND used=false AND expires_at>$2 RETURNING id",[row.id,Date.now()]);if(!result.rows.length)throw new Error("Sign-in request already used.");await q.query("INSERT INTO sessions(id,address,expires_at) VALUES($1,$2,$3)",[hash(token),a,Date.now()+86400000]);});
 const jar=await cookies();jar.set("studio-session",token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/",maxAge:86400});return {address:a};
}
export async function sessionAddress(){const token=(await cookies()).get("studio-session")?.value;if(!token)return null;const db=await database();const rows=await db.query<{address:string}>("SELECT address FROM sessions WHERE id=$1 AND expires_at>$2",[hash(token),Date.now()]);return rows.rows[0]?.address||null;}
export async function workspaceIdentity(mode:"demo"|"live"){
 const jar=await cookies();
 if(mode==="live"){const a=await sessionAddress();if(!a)throw new Error("Connect and sign in with the owner wallet.");return {id:"live:"+a.toLowerCase(),owner:a,actor:a,role:"owner" as const};}
 let sid=jar.get("studio-demo")?.value;if(!sid||!/^\w{48}$/.test(sid)){sid=randomBytes(24).toString("hex");jar.set("studio-demo",sid,{httpOnly:true,sameSite:"strict",path:"/",maxAge:2592000,secure:process.env.NODE_ENV==="production"});}
 return {id:"demo:"+sid,owner:null,actor:null,role:"owner" as const};
}
