import {describe,it,expect} from 'vitest';
import {keccak256} from 'viem';
import {executeClaimedRun, type ExecutionPorts, type ExecutionRecord} from '../apps/worker/src/automation/runner';

const hash=keccak256('0x1234');
function harness() {
 let record:ExecutionRecord={id:'r',state:'claimed',fencingToken:'1',leaseUntil:200};
 const events:string[]=[];
 const ports:ExecutionPorts={
  now:()=>100,
  load:async()=>({...record}),
  save:async(next,fence)=>{if(fence!==record.fencingToken)throw new Error('Lease lost');record={...next};events.push('save:'+next.state);},
  simulate:async()=>{events.push('simulate');},
  sign:async()=>{events.push('sign');return {hash,rawTransaction:'0x1234',nonce:'0',executor:'0x'+'22'.repeat(20),intentHash:hash};},
  broadcast:async()=>{events.push('broadcast');return hash;},
  reconcile:async()=>({state:'pending'}),
 };
 return {ports,events,record:()=>record,set:(r:Partial<ExecutionRecord>)=>{record={...record,...r};}};
}
describe('durable execution boundary',()=>{
 it('clears an earlier pending explanation after canonical confirmation without sending again',async()=>{
  const h=harness();await executeClaimedRun(h.ports,'r','1');
  h.set({reason:'The saved transaction is visible; its receipt is still pending.'});
  h.events.length=0;
  h.ports.reconcile=async()=>({state:'confirmed',receiptBlock:'42',receiptBlockHash:hash});
  await executeClaimedRun(h.ports,'r','1');
  expect(h.record().state).toBe('confirmed');
  expect(h.record().reason).toBeUndefined();
  expect(h.record().receiptBlock).toBe('42');
  expect(h.events).toEqual(['save:confirmed']);
 });
 it('journals the signed transaction before network broadcast',async()=>{
  const h=harness();await executeClaimedRun(h.ports,'r','1');
  expect(h.events).toEqual(['simulate','sign','save:signed','broadcast','save:pending']);
  expect(h.record().signed?.hash).toBe(hash);
 });
 it('does not sign again after broadcast uncertainty or restart',async()=>{
  const h=harness();h.ports.broadcast=async()=>{throw new Error('timeout');};
  await executeClaimedRun(h.ports,'r','1');expect(h.record().state).toBe('unknown');
  h.events.length=0;await executeClaimedRun(h.ports,'r','1');
  expect(h.events).toEqual(['save:pending']);expect(h.record().state).toBe('pending');
 });
 it('can recover a signed but unsent payload by rebroadcasting exactly the same bytes',async()=>{
  const h=harness();await executeClaimedRun(h.ports,'r','1');
  h.events.length=0;h.ports.reconcile=async()=>({state:'unknown',rebroadcastSamePayload:true});
  await executeClaimedRun(h.ports,'r','1');expect(h.events).toEqual(['broadcast','save:pending']);
 });
 it('never broadcasts if persisting the signed intent failed',async()=>{
  const h=harness();h.ports.save=async()=>{throw new Error('DB offline');};
  await expect(executeClaimedRun(h.ports,'r','1')).rejects.toThrow('DB offline');
  expect(h.events).not.toContain('broadcast');
 });
 it('stale fencing and expired leases cannot start signing',async()=>{
  const h=harness();h.set({fencingToken:'2'});
  await expect(executeClaimedRun(h.ports,'r','1')).rejects.toThrow('Lease');
  h.set({fencingToken:'1',leaseUntil:100});
  await expect(executeClaimedRun(h.ports,'r','1')).rejects.toThrow('Lease');
  expect(h.events).toEqual([]);
 });
 it('simulation refusal prevents signing',async()=>{
  const h=harness();h.ports.simulate=async()=>{throw new Error('Buffer protected');};
  await executeClaimedRun(h.ports,'r','1');expect(h.record().state).toBe('blocked');
  expect(h.events).toEqual(['save:blocked']);
 });
 it('confirmed records are rechecked for reorg before being trusted',async()=>{
  const h=harness();await executeClaimedRun(h.ports,'r','1');h.set({state:'confirmed'});
  h.ports.reconcile=async()=>({state:'unknown',reason:'Canonical block changed'});
  await executeClaimedRun(h.ports,'r','1');expect(h.record().state).toBe('unknown');
  expect(h.events.filter(e=>e==='sign')).toHaveLength(1);
 });
 it('reverted records are also reconciled after a reorg without signing again',async()=>{
  const h=harness();await executeClaimedRun(h.ports,'r','1');h.set({state:'reverted'});
  h.ports.reconcile=async()=>({state:'unknown'});
  await executeClaimedRun(h.ports,'r','1');expect(h.record().state).toBe('unknown');
  expect(h.events.filter(e=>e==='sign')).toHaveLength(1);
 });
});
