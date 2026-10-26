/** A mounted action may open one wallet request automatically; retries are explicit. */
export function createWalletStartGate() {
 const started=new Set<string>();
 return (key:string,state:{ready:boolean;provider:boolean;hash:string;uncertain:boolean;busy:boolean})=>{
  if(started.has(key)||!state.ready||!state.provider||state.hash||state.uncertain||state.busy)return false;
  started.add(key);return true;
 };
}

export function walletRequestDeclined(error:unknown,depth=0):boolean {
 if(depth>4||!error||typeof error!=='object')return false;
 const value=error as Record<string,unknown>;
 if(value.code===4001)return true;
 return [value.cause,value.error,value.data&&typeof value.data==='object'?(value.data as Record<string,unknown>).originalError:undefined].some(item=>walletRequestDeclined(item,depth+1));
}

export function confirmationFailure(error:unknown):string|null {
 const text=error instanceof Error?error.message:typeof error==='string'?error:'';
 // RPC absence/timeouts never establish a failed transaction.
 return /transaction reverted|not a successful contract creation|wrong confirmation chain|wrong deployment chain|not sent by this owner|does not match|does not match the approved|already has another automation vault/i.test(text)?text:null;
}

export async function watchConfirmation(ports:{
 check:()=>Promise<void>;cancelled:()=>boolean;sleep:(ms:number)=>Promise<void>;
 onConfirmed:()=>void;onFailed:(message:string)=>void;onWaiting:()=>void;onTimeout:()=>void;
},attempts=40,delayMs=3000) {
 for(let i=0;i<attempts;i++){
  if(ports.cancelled())return;
  try {await ports.check();if(!ports.cancelled())ports.onConfirmed();return;}
  catch(error){if(ports.cancelled())return;const failure=confirmationFailure(error);if(failure){ports.onFailed(failure);return;}ports.onWaiting();}
  if(i+1<attempts)await ports.sleep(delayMs);
 }
 if(!ports.cancelled())ports.onTimeout();
}
