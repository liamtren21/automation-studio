import {randomUUID} from 'node:crypto';
import {getAddress,isAddress,keccak256,toHex} from 'viem';
import type {Database,Sql} from '../../../../../packages/db/src/database';
import {parseMusd} from '../../../../../packages/domain/src/money';
export interface Obligation {id:string;name:string;amount:string;dueDate:string;status:'open'|'settled';revision:number}
export interface Watch {id:string;borrower:string;thresholdBps:number;recoveryBps:number;cooldownSeconds:number;intervalSeconds:number;active:boolean;nextDue:number;lastChecked:number|null;lastSuccessAt:number|null;lastResult:{source:string;status:string;icrBps?:string;blockNumber?:string}|null;lastError:string|null;state:string}
export async function openObligationProtection(db:Sql,workspaceId:string){
 const rows=(await db.query<{id:string;amount:string;due_date:string;status:string;revision:number}>('SELECT id,amount::text,due_date,status,revision FROM studio_obligations WHERE workspace_id=$1 ORDER BY id',[workspaceId])).rows;
 return {amount:rows.filter(r=>r.status==='open').reduce((n,r)=>n+BigInt(r.amount),0n).toString(),revisionHash:keccak256(toHex(JSON.stringify(rows)))};
}
export async function listOperations(db:Sql,workspaceId:string){
 const obligations=(await db.query<Obligation>('SELECT id,name,amount::text,due_date AS "dueDate",status,revision FROM studio_obligations WHERE workspace_id=$1 ORDER BY due_date,id',[workspaceId])).rows;
 const income=(await db.query<{id:string;name:string;amount:string;dueDate:string}>('SELECT id,name,amount::text,due_date AS "dueDate" FROM studio_expected_income WHERE workspace_id=$1 ORDER BY due_date,id',[workspaceId])).rows;
 const watches=(await db.query<Watch>('SELECT id,borrower,threshold_bps AS "thresholdBps",recovery_bps AS "recoveryBps",cooldown_seconds AS "cooldownSeconds",interval_seconds AS "intervalSeconds",active,next_due::float8 AS "nextDue",last_checked::float8 AS "lastChecked",last_success_at::float8 AS "lastSuccessAt",last_result AS "lastResult",last_error AS "lastError",state FROM studio_trove_watches WHERE workspace_id=$1 ORDER BY id',[workspaceId])).rows;
 const notifications=(await db.query<{id:string;message:string;actionPath:string;createdAt:number}>('SELECT id,message,action_path AS "actionPath",created_at::float8 AS "createdAt" FROM studio_operation_notifications WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 50',[workspaceId])).rows;
 const heartbeat=(await db.query<{at:number;checked:number;errors:number}>('SELECT at::float8 AS at,checked,errors FROM studio_monitor_heartbeat WHERE id=\'scheduler\'')).rows[0]??null;
 return {obligations,income,watches,notifications,heartbeat};
}
function details(b:Record<string,unknown>){
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw new Error('Enter a name up to 80 characters.');
 if(typeof b.amount!=='string')throw new Error('Enter an MUSD amount.');const amount=parseMusd(b.amount);if(amount<=0n)throw new Error('Amount must be positive.');
 if(typeof b.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||!Number.isFinite(Date.parse(b.dueDate))||new Date(b.dueDate).toISOString().slice(0,10)!==b.dueDate)throw new Error('Choose a valid due date.');
 return [b.name.trim(),amount.toString(),b.dueDate];
}
export async function mutateOperation(db:Database,workspaceId:string,b:Record<string,unknown>,now=Math.floor(Date.now()/1000)){
 const id=typeof b.id==='string'?b.id:'';
 switch(b.action){
 case 'create_obligation':case 'create_income':{const values=details(b);await db.transaction(async q=>{await q.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId]);const table=b.action==='create_obligation'?'studio_obligations':'studio_expected_income';const count=(await q.query<{n:number}>(`SELECT count(*)::integer AS n FROM ${table} WHERE workspace_id=$1`,[workspaceId])).rows[0]!.n;if(count>=500)throw new Error('Workspace record limit reached.');await q.query(`INSERT INTO ${table}(id,workspace_id,name,amount,due_date) VALUES($1,$2,$3,$4,$5)`,[randomUUID(),workspaceId,...values]);});break;}
 case 'settle_obligation':{const result=await db.query("UPDATE studio_obligations SET status='settled',revision=revision+1 WHERE id=$1 AND workspace_id=$2 AND status='open' RETURNING id",[id,workspaceId]);if(!result.rows.length)throw new Error('Open obligation not found.');break;}
 case 'save_watch':{
 if(typeof b.borrower!=='string'||!isAddress(b.borrower))throw new Error('Enter a valid borrower address.');
 const threshold=b.thresholdBps,interval=b.intervalSeconds;if(typeof threshold!=='number'||!Number.isSafeInteger(threshold)||threshold<11000||threshold>1000000)throw new Error('Collateral threshold must be between 110% and 10000%.');if(typeof interval!=='number'||!Number.isSafeInteger(interval)||interval<60||interval>86400)throw new Error('Check interval must be between 60 and 86400 seconds.');
 const recovery=b.recoveryBps??threshold+500,cooldown=b.cooldownSeconds??600;
 if(typeof recovery!=='number'||!Number.isSafeInteger(recovery)||recovery<=threshold||recovery>1000500)throw new Error('Recovery threshold must be above the alert threshold.');
 if(typeof cooldown!=='number'||!Number.isSafeInteger(cooldown)||cooldown<60||cooldown>86400)throw new Error('Alert cooldown must be between 60 and 86400 seconds.');
 await db.transaction(async q=>{await q.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId]);const address=getAddress(b.borrower as string).toLowerCase();const count=(await q.query<{n:number}>('SELECT count(*)::integer AS n FROM studio_trove_watches WHERE workspace_id=$1 AND borrower<>$2',[workspaceId,address])).rows[0]!.n;if(count>=20)throw new Error('Watch limit reached (20).');await q.query('INSERT INTO studio_trove_watches(id,workspace_id,borrower,threshold_bps,interval_seconds,next_due,recovery_bps,cooldown_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,borrower) DO UPDATE SET threshold_bps=$4,interval_seconds=$5,active=true,next_due=$6,recovery_bps=$7,cooldown_seconds=$8,revision=studio_trove_watches.revision+1,lease_token=NULL,lease_until=0',[randomUUID(),workspaceId,address,threshold,interval,now,recovery,cooldown]);});break;}
 case 'pause_watch':case 'check_watch':{const result=await db.query(b.action==='pause_watch'?'UPDATE studio_trove_watches SET active=false,revision=revision+1,lease_token=NULL,lease_until=0 WHERE id=$1 AND workspace_id=$2 RETURNING id':'UPDATE studio_trove_watches SET active=true,next_due=$3,revision=revision+1,lease_token=NULL,lease_until=0 WHERE id=$1 AND workspace_id=$2 RETURNING id',b.action==='pause_watch'?[id,workspaceId]:[id,workspaceId,now]);if(!result.rows.length)throw new Error('Watch not found.');break;}
 default:throw new Error('Unknown operation.');
 }
 return listOperations(db,workspaceId);
}
