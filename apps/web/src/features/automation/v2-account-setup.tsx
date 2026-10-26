'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {useOkxProvider} from '../../components/okx-provider';
import {assertSetupWallet,ensureSetupChain,setupWalletError} from '../../components/setup-wallet';
import {automationV2DeploymentData} from '../../../../../packages/mezo/src/automation-v2-deployment';
import {parseMusd} from '../../../../../packages/domain/src/money';
import {watchConfirmation,walletRequestDeclined} from './wallet-flow';
import type {V2AccountBinding} from '../../server/automation/v2-account';

async function api(action?:string,body:Record<string,unknown>={}){
 const response=await fetch('/api/automation/v2?mode=live',action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live',action,...body})}:{cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error??'Could not update your group payment account.');return data;
}
export function V2AccountSetup({mode,owner,onReady}:{mode:'demo'|'live';owner?:string;onReady?:()=>void|Promise<void>}){
 const provider=useOkxProvider(),[budget,setBudget]=useState('0.02'),[account,setAccount]=useState<V2AccountBinding|null>(null),[enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[hash,setHash]=useState(''),[uncertain,setUncertain]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[waiting,setWaiting]=useState(''),[polling,setPolling]=useState(false),[pollRound,setPollRound]=useState(0);
 const key=owner?'studio:v2-account:'+mode+':'+owner.toLowerCase():'',mounted=useRef(true),lock=useRef(false),ready=useRef(onReady);ready.current=onReady;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(mode!=='live'||!owner){setLoading(false);return;}let active=true;setLoading(true);void api().then(data=>{if(active){setAccount(data.account);setEnabled(data.capabilities?.deploymentEnabled===true);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[mode,owner]);
 useEffect(()=>{if(!key)return;try{const stored=JSON.parse(localStorage.getItem(key)??'null');if(stored?.globalBudget&&typeof stored.globalBudget==='string')setBudget(stored.globalBudget);if(/^0x[\da-f]{64}$/i.test(stored?.hash??'')){setHash(stored.hash);setOpen(true);}else if(stored?.uncertain){setUncertain(true);setOpen(true);}}catch{}},[key]);
 const save=useCallback((record:Record<string,unknown>)=>{if(key)localStorage.setItem(key,JSON.stringify(record));},[key]);
 async function create(){
  if(lock.current||uncertain||hash||!owner||!enabled)return;lock.current=true;setBusy(true);setOpen(true);setError('');setWaiting('Getting your account ready…');let sent=false;
  try{
   if(!provider)throw Error('Open the OKX Wallet extension to continue.');
   const amount=parseMusd(budget);if(amount===0n)throw Error('Enter a spending budget greater than zero.');
   const prepared=await api('prepare_account',{globalBudget:budget}),tx=prepared.transaction;
   if(prepared.review?.owner?.toLowerCase()!==owner.toLowerCase()||prepared.review?.globalBudget!==budget||tx.to!==undefined||tx.chainId!==31611||tx.value!=='0x0'||tx.data?.toLowerCase()!==automationV2DeploymentData(owner,budget).toLowerCase())throw Error('The account request does not match your owner and budget.');
   if(!Number.isSafeInteger(prepared.expiresAt)||Date.now()>=prepared.expiresAt||prepared.expiresAt>Date.now()+61000)throw Error('This account request expired. Try again.');
   if(!mounted.current)return;
   await ensureSetupChain(provider);await assertSetupWallet(provider,owner);
   if(!mounted.current)return;
   if(Date.now()>=prepared.expiresAt)throw Error('This account request expired. Try again.');
   save({uncertain:true,globalBudget:budget});sent=true;setWaiting('Confirm account creation in OKX…');
   const result=await provider.request({method:'eth_sendTransaction',params:[{from:owner,data:tx.data,value:'0x0',chainId:'0x7b7b'}]});
   if(typeof result!=='string'||!/^0x[\da-f]{64}$/i.test(result))throw Error('The wallet did not return a transaction hash. Check OKX activity.');
   save({hash:result,globalBudget:budget});if(mounted.current)setHash(result);
  }catch(e){const declined=walletRequestDeclined(e);if(declined&&key)localStorage.removeItem(key);if(mounted.current){if(sent&&!declined)setUncertain(true);setError(setupWalletError(e,'Creating your group payment account'));setWaiting('');}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 useEffect(()=>{
  if(!hash||!owner||confirmed)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;setPolling(true);setError('');setWaiting('Waiting for account confirmation…');
  void watchConfirmation({cancelled:()=>cancelled,sleep:ms=>new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,ms);}),check:async()=>{const binding=await api('bind_account',{txHash:hash,globalBudget:budget});if(!cancelled)setAccount(binding);},onConfirmed:()=>{setConfirmed(true);setPolling(false);setWaiting('');if(key)localStorage.removeItem(key);void Promise.resolve(ready.current?.()).catch(()=>{});},onFailed:message=>{setError(message);setPolling(false);setWaiting('');},onWaiting:()=>setWaiting('Waiting for account confirmation…'),onTimeout:()=>{setPolling(false);setWaiting('The network is taking longer than usual. Your transaction is saved. Check again later.');}});
  return()=>{cancelled=true;if(timer)clearTimeout(timer);wake?.();};
 },[hash,owner,confirmed,pollRound,budget,key]);
 if(mode!=='live')return <section className="as-soft"><h3>Try group payments first</h3><p>Use the draft form to plan payments. No wallet or real funds are needed in demo.</p></section>;
 return <section className="as-card"><h2>{account?'Your group payment account is ready':'Set up group payments'}</h2><p>Group payments use a separate account. Your existing payment account and its funds stay where they are.</p>{account?<><p>You can save group payment drafts. Automatic group payments are not enabled yet.</p><details><summary>Account details</summary><p className="as-address">{account.address}</p><a href={'https://explorer.test.mezo.org/tx/'+account.txHash} target="_blank" rel="noreferrer">View account creation</a></details></>:loading?<p role="status">Checking your account…</p>:!owner?<p>Connect your owner wallet to create a group payment account.</p>:!enabled?<p>Account setup will be available after the group payment checks are complete. You can save a draft now.</p>:<><p>Mezo Testnet only. This new account is unaudited. Creating it does not move MUSD or start payments; BTC pays the network fee.</p><label className="as-form">Total account spending limit (MUSD)<input inputMode="decimal" value={budget} disabled={busy||!!hash||uncertain} onChange={e=>setBudget(e.target.value)}/></label><button className="as-button as-primary" disabled={busy||!!hash||uncertain} onClick={()=>void create()}>Create group payment account in OKX</button></>}{(hash||uncertain)&&!open&&<button className="as-button" onClick={()=>setOpen(true)}>View account setup</button>}{error&&!open&&<p role="alert" className="as-error">{error}</p>}
 <Dialog.Root open={open} onOpenChange={next=>{if(!busy)setOpen(next);}}><Dialog.Portal><Dialog.Overlay className="as-dialog-overlay"/><Dialog.Content className="as-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}><Dialog.Title>{confirmed?'Group payment account created':'Create your group payment account'}</Dialog.Title><Dialog.Description>{confirmed?'Your new testnet account is ready. No MUSD was moved and no automatic payments have started.':'Create a separate testnet account with a total spending limit of '+budget+' MUSD.'}</Dialog.Description><p role="status" aria-live="polite" className={error?'as-error':confirmed?'as-success':'as-small'}>{error||(confirmed?'Completed successfully.':waiting)}</p>{uncertain&&!hash&&<label className="as-form">Existing transaction hash from OKX<input placeholder="0x…" onChange={e=>{if(/^0x[\da-f]{64}$/i.test(e.target.value)){setHash(e.target.value);save({hash:e.target.value,globalBudget:budget});}}}/><small>Check wallet activity first. We will check the existing request without sending another.</small></label>}{hash&&<a href={'https://explorer.test.mezo.org/tx/'+hash} target="_blank" rel="noreferrer">View transaction</a>}<div className="as-actions">{confirmed?<button className="as-button as-primary" onClick={()=>setOpen(false)}>OK</button>:<><button className="as-button" disabled={busy} onClick={()=>setOpen(false)}>{hash?'Close':'Cancel'}</button>{!hash&&!uncertain&&error&&<button className="as-button as-primary" disabled={busy} onClick={()=>void create()}>Try again in OKX</button>}{hash&&!polling&&!error&&<button className="as-button" onClick={()=>setPollRound(r=>r+1)}>Check again</button>}</>}</div></Dialog.Content></Dialog.Portal></Dialog.Root></section>;
}
