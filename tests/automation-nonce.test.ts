import {afterEach,it,expect} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {reserveExecutorNonce,settleExecutorNonce} from '../apps/worker/src/automation/nonce-manager';
const opened:Database[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(db=>db.close()));});
async function setup(){const db=await createDatabase('memory://');opened.push(db);return db;}
const base={chainId:'31611',executor:'0x'+'11'.repeat(20),latestNonce:'0',pendingNonce:'0',intentHash:'0x'+'33'.repeat(32),fencingToken:'1'};
it('serializes one executor across workspaces/vaults and persists nonce after settlement',async()=>{
 const db=await setup();await reserveExecutorNonce(db,{...base,runId:'vault-a'});
 await expect(reserveExecutorNonce(db,{...base,runId:'vault-b'})).rejects.toThrow(/unresolved/);
 await settleExecutorNonce(db,base,'vault-a','0');
 await expect(reserveExecutorNonce(db,{...base,runId:'vault-b'})).rejects.toThrow(/stale/);
 expect(await reserveExecutorNonce(db,{...base,runId:'vault-b',latestNonce:'1',pendingNonce:'1'})).toBe('1');
});
it('refuses unknown pending transactions and mismatched settlement',async()=>{
 const db=await setup();await expect(reserveExecutorNonce(db,{...base,runId:'a',pendingNonce:'1'})).rejects.toThrow(/pending/);
 await reserveExecutorNonce(db,{...base,runId:'a'});
 await expect(settleExecutorNonce(db,base,'b','0')).rejects.toThrow();
 expect(await reserveExecutorNonce(db,{...base,runId:'a',fencingToken:'2'})).toBe('0');
 await expect(reserveExecutorNonce(db,{...base,runId:'a',intentHash:'0x'+'44'.repeat(32),fencingToken:'3'})).rejects.toThrow(/unresolved/);
});
it('rejects stale recovery fencing and unexplained gaps after settlement',async()=>{
 const db=await setup();await reserveExecutorNonce(db,{...base,runId:'a'});
 await reserveExecutorNonce(db,{...base,runId:'a',fencingToken:'2'});
 await expect(reserveExecutorNonce(db,{...base,runId:'a'})).rejects.toThrow(/fenc/);
 await settleExecutorNonce(db,base,'a','0');
 await expect(reserveExecutorNonce(db,{...base,runId:'b',latestNonce:'3',pendingNonce:'3'})).rejects.toThrow(/gap/);
});
