import {rateLimit} from './rate-limit';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Database} from '../../../../../packages/db/src/database';
import {integer} from '../../../../../packages/automation/src/studio';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function createAutomationShare(db:Database,workspaceId:string,input:{chainId:string;vault:string;name:string;recipient:string;amount:string;startAt:string;endAt:string;intervalSeconds:string;lifetimeCap:string},now:number,expiresAt:number) {
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+7*86400)throw new Error('Share expiry must be within seven days.');
 const {chainId,vault,name,recipient,amount,startAt,endAt,intervalSeconds,lifetimeCap}=input;
 [chainId,amount,startAt,endAt,intervalSeconds,lifetimeCap].forEach(integer);
 if(!/^0x[0-9a-f]{40}$/i.test(vault)||!/^0x[0-9a-f]{40}$/i.test(recipient)||!name||name.length>80)throw new Error('Invalid public schedule.');
 const token=randomBytes(32).toString('hex'),body={chainId,vault,name,recipient,amount,startAt,endAt,intervalSeconds,lifetimeCap,disclosure:'This is a shared schedule snapshot, not proof of an active permission or future payment.',capturedAt:now};
 await db.query('INSERT INTO automation_share_tokens(token_hash,workspace_id,chain_id,vault,body,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[digest(token),workspaceId,chainId,vault.toLowerCase(),JSON.stringify(body),String(expiresAt)]);
 return {token,path:'/automation/share/'+token,expiresAt};
}
export async function readAutomationShare(db:Database,token:string,now=Math.floor(Date.now()/1000)) {
 if(!/^[0-9a-f]{64}$/.test(token))return null;
 try{await rateLimit(db,'read-share:'+digest(token),120,now);}catch{return null;}
 return (await db.query<{body:Record<string,string|number>}>('SELECT body FROM automation_share_tokens WHERE token_hash=$1 AND revoked=false AND expires_at>$2',[digest(token),String(now)])).rows[0]?.body??null;
}
export async function revokeAutomationShare(db:Database,workspaceId:string,token:string) {
 const rows=await db.query('UPDATE automation_share_tokens SET revoked=true WHERE token_hash=$1 AND workspace_id=$2 RETURNING token_hash',[digest(token),workspaceId]);
 if(!rows.rows.length)throw new Error('Share not found in this workspace.');
}
export async function notifyAutomation(db:Database,i:{workspaceId:string;chainId:string;vault:string;policyId:string;reason:string;episode:string;message:string}) {
 await db.query('INSERT INTO automation_notifications(id,workspace_id,chain_id,vault,policy_id,reason,episode,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(workspace_id,chain_id,vault,policy_id,reason,episode) DO NOTHING',[randomUUID(),i.workspaceId,i.chainId,i.vault.toLowerCase(),i.policyId,i.reason,i.episode,JSON.stringify({message:i.message,path:'/automation?mode=live#'+(i.reason.includes('PROTECTION')||i.reason==='GAS_LOW'?'runtime':i.reason.includes('CAP')||i.reason.includes('CASH')?'allocation-plan':'permissions')})]);
}
