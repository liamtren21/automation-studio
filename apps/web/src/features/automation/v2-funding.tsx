'use client';
import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {formatUnits,type Address} from 'viem';
import {useOkxProvider} from '../../components/okx-provider';
import {assertSetupWallet,ensureSetupChain,setupWalletError} from '../../components/setup-wallet';
import {groupFundingData} from '../../../../../packages/mezo/src/automation-v2-funding';
import {officialTestnetMusd} from '../../../../../packages/mezo/src/network';
import {walletRequestDeclined,watchConfirmation} from './wallet-flow';
async function request(action:string,body:Record<string,unknown>){const r=await fetch('/api/automation/v2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live',action,...body})}),out=await r.json();if(!r.ok)throw Error(out.error||'Could not check this deposit.');return out;}
export function V2Funding({owner,account,draftId,amount,funded,onUpdated}:{owner:Address;account:Address;draftId:string;amount:string;funded:boolean;onUpdated:()=>Promise<void>}){
 const provider=useOkxProvider(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[hash,setHash]=useState(''),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[polling,setPolling]=useState(false),[round,setRound]=useState(0),[waiting,setWaiting]=useState('');
 const lock=useRef(false),mounted=useRef(true),updated=useRef(onUpdated);updated.current=onUpdated;
 const storageKey='studio:v2-funding:'+owner.toLowerCase()+':'+account.toLowerCase()+':'+draftId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem(storageKey)??'null');if(/^0x[0-9a-f]{64}$/i.test(stored?.hash??'')){setHash(stored.hash);setOpen(true);}else if(stored?.uncertain){setUncertain(true);setOpen(true);}}catch{}},[storageKey]);
 async function deposit(){if(lock.current||hash||uncertain||funded)return;lock.current=true;setBusy(true);setOpen(true);setError('');setWaiting('Getting your deposit ready…');let sent=false;
  try{
   if(!provider)throw Error('Open OKX Wallet to continue.');
   const prepared=await request('prepare_funding',{draftId}),tx=prepared.transaction,review=prepared.review;
   if(review.owner?.toLowerCase()!==owner.toLowerCase()||review.account?.toLowerCase()!==account.toLowerCase()||review.draftId!==draftId||review.amount!==amount||tx.to?.toLowerCase()!==officialTestnetMusd.toLowerCase()||tx.data?.toLowerCase()!==groupFundingData(account,amount).toLowerCase()||tx.value!=='0x0'||tx.chainId!==31611)throw Error('Deposit does not match this account and group payment.');
   if(!Number.isSafeInteger(prepared.expiresAt)||Date.now()>=prepared.expiresAt||prepared.expiresAt>Date.now()+61000)throw Error('Deposit review expired. Try again.');
   if(!mounted.current)return;await ensureSetupChain(provider);await assertSetupWallet(provider,owner);if(!mounted.current)return;
   if(Date.now()>=prepared.expiresAt)throw Error('Deposit review expired. Try again.');
   localStorage.setItem(storageKey,JSON.stringify({uncertain:true}));sent=true;setWaiting('Confirm the deposit in OKX…');
   const result=await provider.request({method:'eth_sendTransaction',params:[{from:owner,to:officialTestnetMusd,data:tx.data,value:'0x0',chainId:'0x7b7b'}]});
   if(typeof result!=='string'||!/^0x[0-9a-f]{64}$/i.test(result))throw Error('Check OKX activity for the submitted transaction.');
   localStorage.setItem(storageKey,JSON.stringify({hash:result}));if(mounted.current)setHash(result);
  }catch(e){const declined=walletRequestDeclined(e);if(declined)localStorage.removeItem(storageKey);if(mounted.current){setUncertain(sent&&!declined);setError(setupWalletError(e,'Adding funds'));setWaiting('');}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 useEffect(()=>{if(!hash||confirmed)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;setPolling(true);setError('');setWaiting('Waiting for deposit confirmation…');
  void watchConfirmation({cancelled:()=>cancelled,sleep:ms=>new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,ms);}),check:async()=>{await request('confirm_funding',{draftId,txHash:hash});},onWaiting:()=>setWaiting('Waiting for deposit confirmation…'),onConfirmed:()=>{setConfirmed(true);setPolling(false);setWaiting('');localStorage.removeItem(storageKey);void updated.current();},onFailed:message=>{setError(message);setPolling(false);},onTimeout:()=>{setPolling(false);setWaiting('Confirmation is taking longer than usual. Your transaction is saved; check again later.');}});
  return()=>{cancelled=true;if(timer)clearTimeout(timer);wake?.();};
 },[hash,confirmed,round,draftId,storageKey]);
 return <div className="as-soft"><h3>{funded||confirmed?'Group payment funded':'Add money for this group payment'}</h3><p>{funded||confirmed?formatUnits(BigInt(amount),18)+' MUSD deposit confirmed.':'Move '+formatUnits(BigInt(amount),18)+' test MUSD from your wallet to the new group payment account. This does not start payments.'}</p>{!funded&&!confirmed&&<button className="as-button as-primary" disabled={busy||!!hash||uncertain} onClick={()=>void deposit()}>Add {formatUnits(BigInt(amount),18)} MUSD in OKX</button>}{(hash||uncertain)&&!confirmed&&<button className="as-button" onClick={()=>setOpen(true)}>View deposit status</button>}
 <Dialog.Root open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><Dialog.Portal><Dialog.Overlay className="as-dialog-overlay"/><Dialog.Content className="as-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}><Dialog.Title>{confirmed?'Funds added':'Add funds for your group payment'}</Dialog.Title><Dialog.Description>{formatUnits(BigInt(amount),18)} test MUSD · Your new group payment account</Dialog.Description><p role="status" aria-live="polite" className={error?'as-error':confirmed?'as-success':'as-small'}>{error||(confirmed?'Deposit confirmed. No group payments have been sent.':waiting)}</p>{uncertain&&!hash&&<label className="as-form">Existing transaction hash from OKX<input placeholder="0x…" onChange={e=>{if(/^0x[0-9a-f]{64}$/i.test(e.target.value)){localStorage.setItem(storageKey,JSON.stringify({hash:e.target.value}));setHash(e.target.value);}}}/></label>}{hash&&<a href={'https://explorer.test.mezo.org/tx/'+hash} target="_blank" rel="noreferrer">View transaction</a>}<div className="as-actions">{confirmed?<button className="as-button as-primary" onClick={()=>setOpen(false)}>OK</button>:<><button className="as-button" disabled={busy} onClick={()=>setOpen(false)}>{hash?'Close':'Cancel'}</button>{error&&!hash&&!uncertain&&<button className="as-button" disabled={busy} onClick={()=>void deposit()}>Try again in OKX</button>}{hash&&!polling&&!error&&<button className="as-button" onClick={()=>setRound(r=>r+1)}>Check again</button>}</>}</div></Dialog.Content></Dialog.Portal></Dialog.Root></div>;
}
