/** Bounded readonly recovery for load-balanced RPC nodes. Receipt verification remains mandatory. */
export async function readTransactionEvidence<T,R>(reader:{getTransaction:(input:{hash:`0x${string}`})=>Promise<T>;getTransactionReceipt:(input:{hash:`0x${string}`})=>Promise<R>},hash:`0x${string}`,attempts=3){
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw Error('Invalid evidence retry bound.');
 async function read<V>(operation:()=>Promise<V>):Promise<V>{let last:unknown;for(let n=0;n<attempts;n++){try{return await operation();}catch(e){last=e;}}throw last;}
 const [tx,receipt]=await Promise.all([read(()=>reader.getTransaction({hash})),read(()=>reader.getTransactionReceipt({hash}))]);
 return {tx,receipt};
}
