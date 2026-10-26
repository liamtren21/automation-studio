import {rateLimit} from '@/server/automation/rate-limit';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '../../../../../../../packages/db/src/database';
import {requireRole} from '../../../../../../../packages/db/src/memberships';
import {listAutomationPolicies} from '../../../../../../../packages/db/src/automation';
import {workspaceIdentity} from '@/server/auth';
import {readBody,modeOf,errorResponse} from '@/server/http';
import {createAutomationShare,revokeAutomationShare} from '@/server/automation/shares';
export async function POST(req:NextRequest){try{const b=await readBody(req),mode=modeOf(b.mode),identity=await workspaceIdentity(mode),db=await database();await requireRole(db,identity.id,identity.actor??'scenario',['owner']);await rateLimit(db,'share:'+identity.id,20);
 if(b.action==='revoke'){if(typeof b.token!=='string')throw new Error('Share token required.');await revokeAutomationShare(db,identity.id,b.token);return NextResponse.json({revoked:true});}
 if(b.consent!==true)throw new Error('Review and confirm the public recipient, amount and schedule before sharing.');
 const row=(await listAutomationPolicies(db,identity.id)).filter(r=>r.policy.policyId===b.policyId).sort((a,b)=>Number(BigInt(b.policy.version)-BigInt(a.policy.version)))[0];if(!row)throw new Error('Policy not found.');
 const name=(await db.query<{display_name:string}>('SELECT display_name FROM automation_policies WHERE workspace_id=$1 AND policy_id=$2 AND version=$3',[identity.id,row.policy.policyId,row.policy.version])).rows[0]?.display_name??'Scheduled payment';
 const now=Math.floor(Date.now()/1000);return NextResponse.json(await createAutomationShare(db,identity.id,{...row.policy,name},now,now+86400),{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return errorResponse(e);}}
