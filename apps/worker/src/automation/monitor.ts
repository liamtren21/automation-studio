import {randomUUID} from 'node:crypto';
import type {Database} from '../../../../packages/db/src/database';
import {readTroveSnapshot,type TroveSnapshot} from '../../../../packages/mezo/src/trove-read';
import {publicClient} from '../../../../packages/mezo/src/network';
interface Claim {id:string;workspace_id:string;borrower:string;threshold_bps:number;recovery_bps:number;cooldown_seconds:number;alert_state:string;last_notified_state:string|null;last_notified_at:string|null;last_error_notified_at:string|null;interval_seconds:number;revision:number;state:string;next_due:string}
/** Read-only scheduler: no wallet, executor, approval, or signing dependency. */
export async function monitorTick(db:Database,options:{now?:number;limit?:number;reader?:(borrower:string)=>Promise<TroveSnapshot>;workerId?:string}={}){
 const now=options.now??Math.floor(Date.now()/1000),limit=options.limit??10;
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('Invalid monitor batch.');
 const reader=options.reader??(borrower=>readTroveSnapshot(publicClient(),borrower));let checked=0,errors=0;
 for(let i=0;i<limit;i++){
  const token=randomUUID();
  const claim=await db.transaction(async q=>{
   const row=(await q.query<Claim>('SELECT id,workspace_id,borrower,threshold_bps,recovery_bps,cooldown_seconds,alert_state,last_notified_state,last_notified_at::text,last_error_notified_at::text,interval_seconds,revision,state,next_due FROM studio_trove_watches WHERE active=true AND next_due<=$1 AND lease_until<=$1 ORDER BY next_due,id LIMIT 1 FOR UPDATE SKIP LOCKED',[now])).rows[0];
   if(!row)return null;
   await q.query('UPDATE studio_trove_watches SET lease_token=$2,lease_until=$3 WHERE id=$1',[row.id,token,now+60]);return row;
  });
  if(!claim)break;
  const started=Date.now();checked++;let error:string|null=null,result:Record<string,unknown>|null=null,state='error';
  try{
   const sample=claim.workspace_id.startsWith('demo:');
   let snapshot:TroveSnapshot;
   if(sample)snapshot={status:'active',icrBaseUnits:'1500000000000000000',borrower:claim.borrower,chainId:31611,blockTimestamp:now,blockNumber:'sample'} as TroveSnapshot;
   else {let timer:ReturnType<typeof setTimeout>|undefined;try{snapshot=await Promise.race([reader(claim.borrower),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Trove read timed out.')),20000);})]);}finally{if(timer)clearTimeout(timer);}}
   if(snapshot.chainId!==31611||snapshot.borrower.toLowerCase()!==claim.borrower||!Number.isSafeInteger(snapshot.blockTimestamp)||snapshot.blockTimestamp>now+60||snapshot.blockTimestamp<now-600)throw new Error('Trove snapshot is stale or belongs to another borrower.');
   if(!/^\d+$/.test(snapshot.icrBaseUnits))throw new Error('Invalid Trove ratio.');
   const icrBps=(BigInt(snapshot.icrBaseUnits)*10000n/10n**18n).toString();
   state=snapshot.status!=='active'?'inactive':BigInt(icrBps)<BigInt(claim.threshold_bps)||(claim.alert_state==='at_risk'&&BigInt(icrBps)<BigInt(claim.recovery_bps))?'at_risk':'healthy';
   result={source:sample?'sample':'mezo_testnet',status:snapshot.status,icrBps,blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash??null,blockTimestamp:snapshot.blockTimestamp};
  }catch(cause){errors++;const short=(cause as {shortMessage?:unknown})?.shortMessage;error=(typeof short==='string'?short:cause instanceof Error?cause.message:'Trove read failed.').replace(/https?:\/\/\S+/gi,'[RPC endpoint]').slice(0,500);}
  const finished=now+Math.floor((Date.now()-started)/1000);
  await db.transaction(async q=>{
   const saved=await q.query('UPDATE studio_trove_watches SET state=$4,last_result=COALESCE($5::jsonb,last_result),last_error=$6,last_checked=$7,last_success_at=CASE WHEN $6::text IS NULL THEN $7 ELSE last_success_at END,next_due=$8,lease_token=NULL,lease_until=0 WHERE id=$1 AND lease_token=$2 AND revision=$3 AND active=true AND lease_until>$7 RETURNING id',[claim.id,token,claim.revision,state,result?JSON.stringify(result):null,error,finished,finished+claim.interval_seconds]);
   if(!saved.rows.length)return;
   // Preserve the last valid risk state through RPC errors; errors cannot prove recovery.
   if(state!=='error')await q.query('UPDATE studio_trove_watches SET alert_state=$2 WHERE id=$1',[claim.id,state]);
   const cooldownPassed=claim.last_notified_at===null||finished-Number(claim.last_notified_at)>=claim.cooldown_seconds;
   const shouldNotify=state==='error'?claim.state!=='error'&&(claim.last_error_notified_at===null||finished-Number(claim.last_error_notified_at)>=claim.cooldown_seconds):state!==claim.last_notified_state&&cooldownPassed;
   if(shouldNotify){const mode=claim.workspace_id.startsWith('demo:')?'demo':'live',path=`/automation?mode=${mode}#trove-watch-${claim.id}`;
    const message=(mode==='demo'?'Sample monitor: ':'')+(state==='error'?`Trove monitor could not check ${claim.borrower}: ${error}`:state==='at_risk'?`Collateral ratio for ${claim.borrower} is below your alert or recovery threshold. Review your Trove before acting.`:state==='inactive'?`No active Trove for ${claim.borrower}. Review or pause this watch.`:`Collateral ratio for ${claim.borrower} recovered above your recovery threshold.`);
    await q.query('INSERT INTO studio_operation_notifications(id,workspace_id,watch_id,episode,state,message,action_path,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(watch_id,episode) DO NOTHING',[randomUUID(),claim.workspace_id,claim.id,`${claim.revision}:${claim.next_due}:${state}`,state,message,path,now]);
    if(state!=='error')await q.query('UPDATE studio_trove_watches SET last_notified_state=$2,last_notified_at=$3 WHERE id=$1',[claim.id,state,finished]);
    else await q.query('UPDATE studio_trove_watches SET last_error_notified_at=$2 WHERE id=$1',[claim.id,finished]);
   }
  });
 }
 await db.query("INSERT INTO studio_monitor_heartbeat(id,at,checked,errors) VALUES('scheduler',$1,$2,$3) ON CONFLICT(id) DO UPDATE SET at=$1,checked=$2,errors=$3",[now,checked,errors]);
 return {checked,errors};
}
