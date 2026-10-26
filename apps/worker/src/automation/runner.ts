/** Durable execution boundary. Ports must persist atomically with fencing;
 * no owner key belongs here. A signed payload always survives before broadcast.
 */
import {keccak256} from 'viem';
export type ExecutionState='claimed'|'signed'|'pending'|'unknown'|'confirmed'|'reverted'|'blocked';
export interface SignedAttempt {hash:`0x${string}`;rawTransaction:`0x${string}`;nonce:string;executor:string;intentHash:string}
export interface ExecutionRecord {
 id:string;state:ExecutionState;fencingToken:string;leaseUntil:number;
 signed?:SignedAttempt;reason?:string;receiptBlock?:string;receiptBlockHash?:string;
}
export interface Reconciliation {state:'pending'|'unknown'|'confirmed'|'reverted';reason?:string;receiptBlock?:string;receiptBlockHash?:string;rebroadcastSamePayload?:boolean}
export interface ExecutionPorts {
 now():number;
 load(id:string):Promise<ExecutionRecord>;
 save(record:ExecutionRecord,fencingToken:string):Promise<void>;
 simulate(record:ExecutionRecord):Promise<void>;
 /** Must reserve an executor nonce durably under a per-executor lock before signing. */
 sign(record:ExecutionRecord):Promise<SignedAttempt>;
 broadcast(raw:`0x${string}`):Promise<`0x${string}`>;
 /** Must validate canonicality, intent, events, transfer and confirmation depth. */
 reconcile(record:ExecutionRecord):Promise<Reconciliation>;
}
function assertLease(record:ExecutionRecord,fence:string,now:number) {
 if(record.fencingToken!==fence||record.leaseUntil<=now)throw new Error('Lease lost or expired.');
}
export async function executeClaimedRun(p:ExecutionPorts,id:string,fence:string):Promise<ExecutionRecord> {
 let record=await p.load(id);
 assertLease(record,fence,p.now());
 if(record.state==='blocked')return record;
 if(record.signed) {
  // Recovery never signs again or chooses a new nonce. Missing receipts are ambiguous.
  let result:Reconciliation;
  try{result=await p.reconcile(record);}catch{result={state:'unknown',reason:'Receipt lookup unavailable. Check the existing transaction before retrying.'};}
  if(result.rebroadcastSamePayload&&result.state==='unknown') {
   assertLease(record,fence,p.now());
   try{
    const hash=await p.broadcast(record.signed.rawTransaction);
    if(hash.toLowerCase()!==record.signed.hash.toLowerCase())throw new Error('Unexpected broadcast hash.');
    result={state:'pending'};
   }catch{result={state:'unknown',reason:'Existing signed payment is still unresolved.'};}
  }
  const {rebroadcastSamePayload:_,...outcome}=result;
  record={...record,...outcome,reason:outcome.reason};await p.save(record,fence);return record;
 }
 if(record.state!=='claimed')throw new Error('Unresolved execution has no signed journal. Manual reconciliation required.');
 try{await p.simulate(record);}catch(error){record={...record,state:'blocked',reason:error instanceof Error?error.message:'Preflight refused.'};await p.save(record,fence);return record;}
 assertLease(record,fence,p.now());
 const signed=await p.sign(record);
 if(!/^0x[0-9a-f]{64}$/i.test(signed.hash)||!/^0x(?:[0-9a-f]{2})+$/i.test(signed.rawTransaction)||keccak256(signed.rawTransaction).toLowerCase()!==signed.hash.toLowerCase())throw new Error('Invalid signed transaction journal.');
 record={...record,signed,state:'signed'};
 await p.save(record,fence); // If this fails, nothing is broadcast.
 assertLease(record,fence,p.now());
 try{
  const hash=await p.broadcast(signed.rawTransaction);
  if(hash.toLowerCase()!==signed.hash.toLowerCase())throw new Error('Unexpected broadcast hash.');
 }catch{
  record={...record,state:'unknown',reason:'Broadcast outcome is unknown. Check the saved transaction; do not create another payment.'};
  await p.save(record,fence);return record;
 }
 record={...record,state:'pending',reason:undefined};await p.save(record,fence);return record;
}
