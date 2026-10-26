import { encodeFunctionData,decodeEventLog,parseAbi,getAddress,zeroAddress,type Address,type Hex,type PublicClient } from 'viem';
import {baseUnits} from '../../domain/src/money';
import {readTroveSnapshot,troveAbi,troveDeployment,type TroveSnapshot} from './trove-read';
export {troveDeployment};
const address=getAddress;
function safeInteger(n:number,label:string,min=0){if(!Number.isSafeInteger(n)||n<min)throw new Error(`Invalid ${label}`);}
type Client=Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'getStorageAt'|'readContract'|'getBalance'|'simulateContract'>;
function read<T>(client:Client,contract:Address,blockNumber:bigint,functionName:string,args:readonly unknown[]=[]):Promise<T>{return client.readContract({address:contract,abi:troveAbi,functionName,args,blockNumber} as Parameters<Client['readContract']>[0]) as Promise<T>;}
async function canonical(client:Client,number:bigint,hash:string){if((await client.getBlock({blockNumber:number})).hash!==hash)throw new Error('Trove snapshot block changed');}
/** Partial repayments only. closeTrove has separate constraints and is outside this adapter. */
export function repaymentEconomics(snapshot:TroveSnapshot,amountBaseUnits:string){
 const amount=baseUnits(amountBaseUnits),principal=baseUnits(snapshot.principalBaseUnits),interest=baseUnits(snapshot.interestBaseUnits),debt=principal+interest;
 if(snapshot.status!=='active'||snapshot.statusCode!==1)throw new Error('Borrower has no active Trove');
 const floor=baseUnits(snapshot.minNetDebtBaseUnits)+baseUnits(snapshot.gasCompensationBaseUnits);
 const maximum=debt>floor?debt-floor:0n;
 if(amount===0n||amount>maximum)throw new Error('Repayment must preserve minimum net debt and gas compensation');
 const interestPaid=amount<interest?amount:interest,principalPaid=amount-interestPaid;
 return {amountBaseUnits:amount.toString(),maxRepaymentBaseUnits:maximum.toString(),interestPaidBaseUnits:interestPaid.toString(),principalPaidBaseUnits:principalPaid.toString(),remainingPrincipalBaseUnits:(principal-principalPaid).toString(),remainingInterestBaseUnits:(interest-interestPaid).toString(),remainingDebtBaseUnits:(debt-amount).toString()};
}
export interface RepaymentInput {borrower:string;ownerAddress:string;amountBaseUnits:string;now?:number;maxSnapshotAgeSeconds?:number}
export async function prepareOwnerRepayment(client:Client,input:RepaymentInput){
 const borrower=address(input.borrower),owner=address(input.ownerAddress);
 if(owner!==borrower)throw new Error('Direct repayment requires the borrower wallet');
 const snapshot=await readTroveSnapshot(client,borrower),n=BigInt(snapshot.blockNumber),d=troveDeployment;
 const now=input.now??Math.floor(Date.now()/1000),maxAge=input.maxSnapshotAgeSeconds??30;safeInteger(now,'current time');safeInteger(maxAge,'snapshot age',1);
 if(now<snapshot.blockTimestamp||now-snapshot.blockTimestamp>=maxAge)throw new Error('Trove snapshot stale or from future');
 const economics=repaymentEconomics(snapshot,input.amountBaseUnits),amount=baseUnits(input.amountBaseUnits);
 if(amount>baseUnits(snapshot.ownerMusdBalanceBaseUnits))throw new Error('Borrower wallet MUSD balance insufficient; treasury withdrawal is separate');
 if(baseUnits(snapshot.ownerGasBalanceBaseUnits)===0n)throw new Error('Borrower requires native BTC gas');
 // SortedTroves ranks collateral / principal, excluding interest. Use the protocol helper.
 const nicr=await read<bigint>(client,d.hintHelpers,n,'computeNominalCR',[BigInt(snapshot.collateralBaseUnits),BigInt(economics.remainingPrincipalBaseUnits)]);
 const size=await read<bigint>(client,d.sortedTroves,n,'getSize');
 // Bounded approximate search; exact insertion and simulation validate the resulting hints.
 const trials=size<64n?size+1n:64n;
 const [approx]=await read<readonly [Address,bigint,bigint]>(client,d.hintHelpers,n,'getApproxHint',[nicr,trials,1n]);
 const [upperHint,lowerHint]=await read<readonly [Address,Address]>(client,d.sortedTroves,n,'findInsertPosition',[nicr,approx??zeroAddress,approx??zeroAddress]);
 const args=[amount,upperHint,lowerHint] as const;
 await client.simulateContract({address:d.borrowerOperations,abi:troveAbi,functionName:'repayMUSD',args,account:owner,blockNumber:n});
 await canonical(client,n,snapshot.blockHash);
 return {chainId:31611,from:owner,to:d.borrowerOperations,data:encodeFunctionData({abi:troveAbi,functionName:'repayMUSD',args}),value:'0',requiresOwnerSignature:true as const,approvalRequired:false as const,expiresAt:snapshot.blockTimestamp+maxAge,upperHint,lowerHint,snapshot,economics};
}

export type OwnerRepayment=Awaited<ReturnType<typeof prepareOwnerRepayment>>;
/** Rebuild the calldata on the signing device; server-provided calldata is never trusted. */
export function validateOwnerRepayment(p:OwnerRepayment,owner:string,amountBaseUnits:string,now=Math.floor(Date.now()/1000)) {
 const d=troveDeployment;
 if(p.chainId!==31611||getAddress(p.from)!==getAddress(owner)||getAddress(p.snapshot.borrower)!==getAddress(owner)||getAddress(p.to)!==getAddress(d.borrowerOperations)||p.value!=='0'||p.requiresOwnerSignature!==true||p.approvalRequired!==false)throw new Error('Repayment identity or network changed.');
 if(!Number.isSafeInteger(p.expiresAt)||now>=p.expiresAt||p.expiresAt>now+30||p.snapshot.blockTimestamp>now||now-p.snapshot.blockTimestamp>=30||p.snapshot.sourceCommit!==d.sourceCommit)throw new Error('Repayment review expired.');
 const economics=repaymentEconomics(p.snapshot,amountBaseUnits);
 if(Object.entries(economics).some(([k,v])=>p.economics[k as keyof typeof economics]!==v)||BigInt(amountBaseUnits)>BigInt(p.snapshot.ownerMusdBalanceBaseUnits)||BigInt(p.snapshot.ownerGasBalanceBaseUnits)<=0n)throw new Error('Repayment amount or wallet funds changed.');
 const expected=encodeFunctionData({abi:troveAbi,functionName:'repayMUSD',args:[baseUnits(amountBaseUnits),getAddress(p.upperHint),getAddress(p.lowerHint)]});
 if(p.data.toLowerCase()!==expected.toLowerCase())throw new Error('Repayment calldata changed.');
 return expected;
}

export const repaymentEvents=parseAbi([
 'event Transfer(address indexed from,address indexed to,uint256 value)',
 'event TroveUpdated(address indexed borrower,uint256 principal,uint256 interest,uint256 coll,uint256 stake,uint16 interestRate,uint256 lastInterestUpdateTime,uint8 operation)',
]);
type ReceiptProof={owner:string;to:string;data:string;nonce?:number;amountBaseUnits:string;tx:{from:string;to:string|null;input:string;value:bigint;nonce:number};receipt:{status:string;blockNumber:bigint;blockHash:string;logs:readonly{address:string;data:string;topics:readonly string[]}[]};head:bigint;canonicalHash:string|null};
export function verifyBoundReceipt(i:ReceiptProof){
 verifyOwnerTransaction(i);
 if(i.receipt.status!=='success')throw new Error('Transaction reverted or is not successful.');
 if(i.head<i.receipt.blockNumber+1n||i.canonicalHash!==i.receipt.blockHash)throw new Error('Receipt awaits two canonical confirmations.');
}
export function verifyOwnerTransaction(i:Pick<ReceiptProof,'tx'|'owner'|'to'|'data'|'nonce'>){
 if(getAddress(i.tx.from)!==getAddress(i.owner)||!i.tx.to||getAddress(i.tx.to)!==getAddress(i.to)||i.tx.input.toLowerCase()!==i.data.toLowerCase()||i.tx.value!==0n||(i.nonce!==undefined&&i.tx.nonce!==i.nonce))throw new Error('Transaction differs from the exact owner request.');
}
export function verifyTokenMovement(logs:ReceiptProof['receipt']['logs'],from:string,to:string,amount:string){
 const matches=logs.filter(log=>{if(getAddress(log.address)!==getAddress(troveDeployment.musd))return false;try{const e=decodeEventLog({abi:repaymentEvents,eventName:'Transfer',data:log.data as Hex,topics:log.topics as [Hex,...Hex[]]});return getAddress(e.args.from)===getAddress(from)&&getAddress(e.args.to)===getAddress(to)&&e.args.value===baseUnits(amount);}catch{return false;}});
 if(matches.length!==1)throw new Error('Missing unique exact MUSD transfer or burn.');
}
export function verifyOwnerRepaymentReceipt(i:ReceiptProof&{principal:bigint;interest:bigint;collateral:bigint;floor:bigint}){
 verifyBoundReceipt(i);verifyTokenMovement(i.receipt.logs,i.owner,zeroAddress,i.amountBaseUnits);
 const events=i.receipt.logs.flatMap(log=>{if(getAddress(log.address)!==getAddress(troveDeployment.borrowerOperations))return [];try{return [decodeEventLog({abi:repaymentEvents,eventName:'TroveUpdated',data:log.data as Hex,topics:log.topics as [Hex,...Hex[]]}).args];}catch{return [];}}).filter(e=>getAddress(e.borrower)===getAddress(i.owner)&&e.operation===2);
 if(events.length!==1||events[0]!.principal!==i.principal||events[0]!.interest!==i.interest||events[0]!.coll!==i.collateral||i.principal+i.interest<i.floor)throw new Error('Repayment debt event does not match canonical Trove state.');
 return {principalBaseUnits:i.principal.toString(),interestBaseUnits:i.interest.toString(),debtBaseUnits:(i.principal+i.interest).toString()};
}

