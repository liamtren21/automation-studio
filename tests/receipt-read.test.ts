import {it,expect} from 'vitest';
import {readTransactionEvidence} from '../packages/mezo/src/receipt-read';
it('retries a missing receipt without discarding a transaction already read',async()=>{
 let txReads=0,receiptReads=0;
 const reader={getTransaction:async()=>{txReads++;return {nonce:1};},getTransactionReceipt:async()=>{if(++receiptReads<3)throw Error('not found');return {status:'success'};}};
 const result=await readTransactionEvidence(reader,'0x12',3);
 expect(result.receipt.status).toBe('success');expect(txReads).toBe(1);expect(receiptReads).toBe(3);
});
it('fails closed after bounded missing evidence and never broadcasts',async()=>{
 let calls=0;await expect(readTransactionEvidence({getTransaction:async()=>({nonce:1}),getTransactionReceipt:async()=>{calls++;throw Error('missing');}},'0x12',2)).rejects.toThrow('missing');expect(calls).toBe(2);
});
