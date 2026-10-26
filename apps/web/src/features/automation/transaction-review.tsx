'use client';
import { StudioWalletConnect } from './wallet-connect';
import {createWalletStartGate,watchConfirmation,walletRequestDeclined} from './wallet-flow';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useOkxProvider } from '../../components/okx-provider';
import { assertSetupWallet, ensureSetupChain, setupWalletError } from '../../components/setup-wallet';
import { automationDeploymentData, automationOperationData, type StudioOperationInput } from '../../../../../packages/mezo/src/automation-payload';
import { officialTestnetMusd } from '../../../../../packages/mezo/src/network';
import {formatUnits} from 'viem';
import { studioApi, money, date, type StudioView } from './studio-client';

export type LiveIntent={operation:'deploy'|'configure'|'allocate'|'release'|'revoke'|'protection'|'executor'|'pause'|'unpause'|'deposit'|'withdraw';policyId?:string;amount?:string;executor?:string;allowed?:boolean;repaymentHandoffId?:string};
type Prepared={transaction:{to?:string;data:string;value:string;chainId:number;nonce?:string};review:Omit<StudioOperationInput,'operation'>&{operation:LiveIntent['operation'];budget?:string;token?:string};expiresAt:number};
const labels:Record<LiveIntent['operation'],string>={deploy:'Create your automation account',configure:'Allow this scheduled payment',allocate:'Set aside this payment’s budget',release:'Release this payment’s unused budget',revoke:'Stop future payments',protection:'Update bills and cash cushion',executor:'Change payment executor access',pause:'Pause all scheduled payments',unpause:'Resume scheduled payments',deposit:'Deposit test MUSD',withdraw:'Withdraw unallocated test MUSD'};
const same=(a?:string,b?:string)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();

export function LiveReview({intent,view,onClose,onUpdated,autoStart=false}:{intent:LiveIntent;view:StudioView;onClose:()=>void;onUpdated:()=>Promise<void>;autoStart?:boolean}) {
 const provider=useOkxProvider();const [prepared,setPrepared]=useState<Prepared|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[hash,setHash]=useState(''),[confirmed,setConfirmed]=useState(false),[uncertain,setUncertain]=useState(false);const feedback=useRef<HTMLParagraphElement>(null);
 const storageKey=useRef('studio:automation:'+JSON.stringify([view.owner??view.account?.owner,view.account?.vault,intent])).current;
 const autoGate=useRef(createWalletStartGate()),sendLock=useRef(false),mounted=useRef(true);
 const [recovered,setRecovered]=useState(false),[polling,setPolling]=useState(false),[pollRound,setPollRound]=useState(0),[waiting,setWaiting]=useState('');
 const updated=useRef(onUpdated);updated.current=onUpdated;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem(storageKey)??'null');if(stored?.hash){setHash(stored.hash);if(stored.prepared)setPrepared(stored.prepared);}else if(stored?.uncertain)setUncertain(true);}catch{/* No valid recovery record. */}finally{setRecovered(true);}},[storageKey]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.hash&&saved.prepared)return;}catch{}let active=true;setBusy(true);const action=intent.operation==='deploy'?'prepare_deployment':'prepare';const body=intent.operation==='deploy'?{budget:intent.amount}:{...intent};void studioApi('live',action,body).then(p=>{if(active)setPrepared(p);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not prepare this permission.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[intent,storageKey]);
 useEffect(()=>{if(autoStart&&recovered&&autoGate.current(storageKey,{ready:!!prepared,provider:!!provider,hash,uncertain,busy}))void sign();},[autoStart,recovered,prepared,provider,hash,uncertain,busy,storageKey]);
 async function sign() {
  if(sendLock.current)return;sendLock.current=true;
  setError('');setBusy(true);setWaiting('');
  let sendRequested=false;
  try {
   if(uncertain)throw new Error('Check OKX activity for the earlier wallet request before creating another payment.');
   if(!prepared||!provider)throw new Error('Open OKX Wallet, then try again.');
   if(!Number.isSafeInteger(prepared.expiresAt)||Date.now()>=prepared.expiresAt||prepared.expiresAt>Date.now()+61000)throw new Error('This review expired or is invalid. Close it and review the action again.');
   const current:StudioView=await studioApi('live'),review=prepared.review,tx=prepared.transaction;
   const owner=current.owner??current.account?.owner;
   if(!owner||!same(owner,review.owner)||review.operation!==intent.operation)throw new Error('Your account changed. Close this review and start again.');
   if(intent.amount!==undefined&&intent.operation!=='deploy'&&review.amount!==intent.amount)throw new Error('The reviewed amount changed.');
   if(intent.policyId&&!same(review.policyId??review.policy?.policyId,intent.policyId))throw new Error('The reviewed payment changed.');
   if(intent.executor&&(!same(review.executor,intent.executor)||review.allowed!==intent.allowed))throw new Error('The executor permission changed.');
   let expected:string;
   if(intent.operation==='deploy'){
    if(current.account||review.budget!==intent.amount||!same(review.token,officialTestnetMusd))throw new Error('The account setup changed. Review it again.');
    expected=automationDeploymentData(owner as `0x${string}`,intent.amount!);
    if(tx.to)throw new Error('Account setup must create a new account.');
   }else{
    const account=current.account;if(!account||!same(account.vault,review.vault)||!same(account.owner,owner))throw new Error('The automation account changed.');
    if(['withdraw','allocate'].includes(intent.operation)&&(!current.source||!same(account.protectionSourceHash,current.source.sourceHash)||BigInt(account.protectionExpiresAt)<=BigInt(account.now)))throw new Error('Update cash protection from your latest obligations before allocating or withdrawing funds.');
    if(intent.policyId){const policy=current.rules.find(r=>same(r.policy.policyId,intent.policyId))?.policy;if(!policy)throw new Error('Payment no longer exists.');if(review.policy&&JSON.stringify(review.policy)!==JSON.stringify(policy))throw new Error('The payment details changed. Review again.');}
    if(intent.operation==='protection'){
      const source=(current as StudioView&{source?:{committedBills:string;buffer:string;sourceHash:string}}).source;
      if(!source||review.committedBills!==source.committedBills||review.buffer!==source.buffer||!same(review.sourceHash,source.sourceHash))throw new Error('Bills or your cash cushion changed. Review updated protection again.');
    }
    expected=automationOperationData({...review,operation:intent.operation}).data;
    const to=intent.operation==='deposit'?officialTestnetMusd:account.vault;
    if(!same(tx.to,to))throw new Error('The transaction recipient does not match this review.');
   }
   if(!same(tx.data,expected)||tx.value!=='0x0'||tx.chainId!==31611)throw new Error('The transaction does not match the permission you reviewed.');
   if(intent.repaymentHandoffId){
    const response=await fetch('/api/automation/repayment?mode=live',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error??'Could not verify withdrawal handoff');
    const records=Array.isArray(data)?data:(data.handoffs??[]);const h=records.find((r:{id:string})=>r.id===intent.repaymentHandoffId);
    if(!h||h.owner.toLowerCase()!==owner.toLowerCase()||h.status!=='awaiting_withdrawal'||h.amount!==intent.amount||h.withdrawalNonce===undefined||tx.nonce!=='0x'+Number(h.withdrawalNonce).toString(16))throw new Error('The pinned withdrawal nonce or handoff changed.');
   }else if(tx.nonce!==undefined)throw new Error('Unexpected nonce in this review.');
   if(!mounted.current)return;
   await ensureSetupChain(provider);await assertSetupWallet(provider,owner);
   if(!mounted.current)return;
   if(Date.now()>=prepared.expiresAt)throw new Error('This review expired. Review again before signing.');
   sendRequested=true;localStorage.setItem(storageKey,JSON.stringify({uncertain:true}));
   const result=await provider.request({method:'eth_sendTransaction',params:[{from:owner,...(tx.to?{to:tx.to}:{}),data:expected,value:'0x0',chainId:'0x7b7b',...(tx.nonce?{nonce:tx.nonce}:{})}]});
   if(typeof result!=='string'||!/^0x[\da-f]{64}$/i.test(result))throw new Error('The wallet did not return a transaction hash. Check wallet activity before trying again.');
   setHash(result);localStorage.setItem(storageKey,JSON.stringify({hash:result,prepared}));
  }catch(e){const rejected=walletRequestDeclined(e);if(rejected)localStorage.removeItem(storageKey);else if(sendRequested)setUncertain(true);setError(setupWalletError(e,'Reviewing this action')+(sendRequested&&!rejected?' Check OKX activity before retrying.':''));}
  finally{sendLock.current=false;if(mounted.current){setBusy(false);requestAnimationFrame(()=>feedback.current?.focus());}}
 }
 useEffect(()=>{
  if(!hash||!prepared||confirmed)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;
  setPolling(true);setError('');setWaiting('Payment sent. Waiting for network confirmation…');
  void watchConfirmation({
   cancelled:()=>cancelled,
   sleep:ms=>new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,ms);}),
   check:async()=>{await studioApi('live',intent.operation==='deploy'?'bind_deployment':'sync',{txHash:hash,expectedTransaction:prepared.transaction});},
   onWaiting:()=>setWaiting('Payment sent. Waiting for network confirmation…'),
   onConfirmed:()=>{setPolling(false);setConfirmed(true);setWaiting('');localStorage.removeItem(storageKey);void updated.current().catch(()=>{if(!cancelled)setWaiting('Your transaction is confirmed. Refresh the account to update its balance.');});},
   onFailed:message=>{setPolling(false);setError(message);setWaiting('');},
   onTimeout:()=>{setPolling(false);setWaiting('This is taking longer than usual. Your transaction is saved. You can close this window and check again later.');},
  });
  return()=>{cancelled=true;if(timer)clearTimeout(timer);wake?.();};
 },[hash,prepared,confirmed,pollRound,intent.operation,storageKey]);
 const review=prepared?.review;const p=review?.policy;
 const success=intent.operation==='revoke'?'Payments stopped':intent.operation==='deposit'?'Funds added':intent.operation==='withdraw'?'Withdrawal complete':intent.operation==='deploy'?'Your payment account is ready':'Changes saved';
 const bot=view.rules.find(r=>same(r.policy.policyId,intent.policyId));
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="as-dialog-overlay"/><Dialog.Content className="as-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}>
 <Dialog.Title>{confirmed?success:labels[intent.operation]}</Dialog.Title>
 <Dialog.Description>{confirmed?(intent.operation==='revoke'?'No more payments will be made by this bot. Your remaining funds stay in your account.':'Your transaction has been confirmed on Mezo Testnet.'):(hash?'Your transaction has been sent. We’ll check confirmation automatically.':autoStart?'Confirm this action in OKX Wallet. BTC pays the network fee.':'Confirm the details below, then approve in OKX Wallet.')}</Dialog.Description>
 {!confirmed&&<>
 {busy&&!prepared&&<p role="status">Getting your request ready…</p>}
 {review&&<dl className="as-definition">
 {bot&&<div><dt>Payment</dt><dd>{bot.name}</dd></div>}
 {(intent.amount||review.budget)&&<div><dt>{intent.operation==='deploy'?'Spending limit':'Amount'}</dt><dd>{intent.amount??review.budget} MUSD</dd></div>}
 {p&&<><div><dt>Recipient</dt><dd className="as-address">{p.recipient}</dd></div><div><dt>Each payment</dt><dd>{formatUnits(BigInt(p.amount),18)} MUSD</dd></div><div><dt>Total budget</dt><dd>{formatUnits(BigInt(p.lifetimeCap),18)} MUSD</dd></div><div><dt>Schedule ends</dt><dd>{date(p.endAt)}</dd></div></>}
 {review.committedBills!==undefined&&<><div><dt>Money for bills</dt><dd>{money(review.committedBills)} MUSD</dd></div><div><dt>Cash cushion</dt><dd>{money(review.buffer)} MUSD</dd></div></>}
 {review.executor&&<div><dt>Automatic payments</dt><dd>{review.allowed?'Allow the payment service to run your approved bots':'Remove payment service access'}</dd></div>}
 </dl>}
 {intent.operation==='deposit'&&<p className="as-small">Funds move from your wallet to your payment account.</p>}{intent.operation==='withdraw'&&<p className="as-small">Available funds return to your owner wallet. Money reserved for payments stays protected.</p>}
 {prepared&&<details><summary>Technical details</summary><p className="as-address">Owner: {review?.owner}</p><p className="as-address">To: {prepared.transaction.to||'New account'}</p><p className="as-address">Data: {prepared.transaction.data}</p><p>Value: 0 BTC · Mezo Testnet (31611)</p></details>}
 </>}
 <p ref={feedback} tabIndex={-1} aria-live="polite" className={error?'as-error':confirmed?'as-success':'as-small'}>{error||(confirmed?'Completed successfully.':hash?waiting:busy?(prepared?'Confirm this action in OKX…':'Getting your request ready…'):uncertain?'Check OKX activity before continuing.':'')}{!error&&waiting&&confirmed?' '+waiting:''}</p>
 {uncertain&&!hash&&<label className="as-form">Transaction hash from OKX<input placeholder="0x…" onChange={e=>{if(/^0x[0-9a-f]{64}$/i.test(e.target.value))setHash(e.target.value);}}/><small>Check OKX activity first. Paste the existing transaction here so we can check it without sending again.</small></label>}
 {!prepared&&error&&<StudioWalletConnect onConnected={async()=>{await onUpdated();onClose();}}/>}
 {hash&&<p><a href={'https://explorer.test.mezo.org/tx/'+hash} target="_blank" rel="noreferrer">View transaction</a></p>}
 <div className="as-actions">
 {confirmed?<button className="as-button as-primary" onClick={onClose}>OK</button>:<>
 <button className="as-button" disabled={busy} onClick={onClose}>{hash?'Close':'Cancel'}</button>
 {!hash&&prepared&&!uncertain&&(provider?<button className="as-button as-primary" disabled={busy} onClick={()=>void sign()}>{busy?'Waiting for OKX…':error?'Try again in OKX':'Open OKX Wallet'}</button>:<StudioWalletConnect onConnected={async()=>{await onUpdated();onClose();}}/>)}
 {hash&&!polling&&!error&&<button className="as-button as-primary" onClick={()=>setPollRound(r=>r+1)}>Check again</button>}
 </>}
 </div>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
