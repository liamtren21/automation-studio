import {expect,it,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {mutateOperation,listOperations} from '../apps/web/src/server/automation/operations';
import {monitorTick} from '../apps/worker/src/automation/monitor';
import type {TroveSnapshot} from '../packages/mezo/src/trove-read';
const borrower='0x1111111111111111111111111111111111111111';
const dbs:Database[]=[];afterEach(async()=>{for(const db of dbs.splice(0))await db.close();});
it('retains risk through the hysteresis band and read errors, and delivers delayed recovery after cooldown',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:h','live')");
 await mutateOperation(db,'live:h',{action:'save_watch',borrower,thresholdBps:16000,recoveryBps:16500,cooldownSeconds:600,intervalSeconds:60},1000);
 const check=async(now:number,bps:number|null)=>monitorTick(db,{now,reader:async()=>{if(bps===null)throw Error('RPC unavailable');return {borrower,chainId:31611,status:'active',blockTimestamp:now,icrBaseUnits:(BigInt(bps)*10n**14n).toString()} as unknown as TroveSnapshot;}});
 await check(1000,15900);expect((await listOperations(db,'live:h')).notifications).toHaveLength(1);
 await check(1060,16200);expect((await listOperations(db,'live:h')).watches[0]!.state).toBe('at_risk');
 await check(1120,null);expect((await listOperations(db,'live:h')).watches[0]!.state).toBe('error');
 await check(1180,16200);expect((await listOperations(db,'live:h')).watches[0]!.state).toBe('at_risk');
 await check(1240,16600);expect((await listOperations(db,'live:h')).notifications.filter(n=>n.message.includes('recovered'))).toHaveLength(0);
 await check(1660,16600);expect((await listOperations(db,'live:h')).notifications.filter(n=>n.message.includes('recovered'))).toHaveLength(1);
 await check(1720,16600);expect((await listOperations(db,'live:h')).notifications.filter(n=>n.message.includes('recovered'))).toHaveLength(1);
},20000);
it('rejects inverted recovery thresholds and unsafe cooldown values',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);await db.query("INSERT INTO workspaces(id,mode) VALUES('live:h','live')");
 await expect(mutateOperation(db,'live:h',{action:'save_watch',borrower,thresholdBps:16000,recoveryBps:15900,intervalSeconds:60},1000)).rejects.toThrow(/recovery/i);
 await expect(mutateOperation(db,'live:h',{action:'save_watch',borrower,thresholdBps:16000,recoveryBps:16500,intervalSeconds:60,cooldownSeconds:-1},1000)).rejects.toThrow(/cooldown/i);
},20000);
