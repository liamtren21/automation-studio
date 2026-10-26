import {openObligationProtection} from './operations';
import {keccak256,toHex} from 'viem';
import type {Sql} from '../../../../../packages/db/src/database';
import {parseMusd,formatMusd} from '../../../../../packages/domain/src/money';

export function assertCurrentCashProtection(state:{sourceHash:string;expires:string;block:{timestamp:bigint}},sourceHash:string){
 if(state.sourceHash.toLowerCase()!==sourceHash.toLowerCase()||BigInt(state.expires)<=state.block.timestamp)throw new Error('Update cash protection from your latest obligations before allocating or withdrawing funds.');
}

/** Owner-declared local settings. An independent signed protection update activates them onchain. */
export function buildProtectionSource(workspaceId:string,committedMusd:string,cushionMusd:string) {
 if(!workspaceId)throw new Error('Workspace required.');
 const committed=parseMusd(committedMusd),buffer=parseMusd(cushionMusd);
 const sourceHash=keccak256(toHex(JSON.stringify({schema:'AutomationStudio.CashProtection.v1',workspaceId,committedBills:committed.toString(),buffer:buffer.toString()})));
 return {committedBills:committed.toString(),buffer:buffer.toString(),protectedFloor:(committed+buffer).toString(),draftTotal:'0',sourceHash,billCount:0};
}
export async function currentProtection(db:Sql,workspaceId:string) {
 const row=(await db.query<{committed_amount:string;cushion_amount:string}>('SELECT committed_amount::text,cushion_amount::text FROM automation_cash_protection WHERE workspace_id=$1',[workspaceId])).rows[0];
 const obligations=await openObligationProtection(db,workspaceId);
 const source=buildProtectionSource(workspaceId,formatMusd(BigInt(row?.committed_amount??'0')+BigInt(obligations.amount)),formatMusd(BigInt(row?.cushion_amount??'0')));
 if(obligations.revisionHash===keccak256(toHex('[]')))return source;
 return {...source,sourceHash:keccak256(toHex(JSON.stringify({schema:'AutomationStudio.Obligations.v1',settings:source.sourceHash,revisionHash:obligations.revisionHash}))),recordedCommitments:obligations.amount,manualCommitments:row?.committed_amount??'0'};
}
export async function saveProtectionSettings(db:Sql,workspaceId:string,input:{committedBills:string;cashCushion:string}) {
 const source=buildProtectionSource(workspaceId,input.committedBills,input.cashCushion);
 await db.query('INSERT INTO automation_cash_protection(workspace_id,committed_amount,cushion_amount) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET committed_amount=EXCLUDED.committed_amount,cushion_amount=EXCLUDED.cushion_amount,updated_at=now()',[workspaceId,source.committedBills,source.buffer]);
 return source;
}
