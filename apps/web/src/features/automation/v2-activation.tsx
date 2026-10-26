'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {formatUnits,type Address} from 'viem';
import {useOkxProvider} from '../../components/okx-provider';
import {assertSetupWallet,ensureSetupChain,setupWalletError} from '../../components/setup-wallet';
import {groupSetupTransaction,type GroupReview,type GroupSetupStep} from '../../../../../packages/mezo/src/automation-v2-setup';
import type {BatchDraft} from '../../../../../packages/automation/src/studio/batch';
import {walletRequestDeclined,watchConfirmation} from './wallet-flow';
interface Status {account:Address;owner:Address;globalBudget:string;step:GroupSetupStep|null;label:string|null;blocked:string|null;approved:boolean;stopped:boolean;completed:boolean;expired:boolean;active:boolean;ready:boolean;serviceEnabled:boolean;source:{committed:string;buffer:string;hash:string};executor:Address|null;allocation:string;spent:string;runs:{id:string;state:string;txHash?:string;reason?:string;block?:string}[]}
interface Prepared {id:string;review:GroupReview;transaction:{to:Address;data:string;value:string;chainId:number};expiresAt:number}
const labels:Record<GroupSetupStep,string>={classify:'Prepare payment budget',protection:'Protect your cash reserve',configure:'Approve this group payment',allocate:'Set money aside for this group',executor:'Enable automatic group payments',revoke:'Stop group payments'};
async function api(draftId:string,action?:string,body:Record<string,unknown>={}){const r=await fetch('/api/automation/v2?mode=live&draftId='+encodeURIComponent(draftId),action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live',draftId,action,...body})}:{cache:'no-store'}),out=await r.json();if(!r.ok)throw Error(out.error||'Could not check this group payment.');return out;}
export function GroupActivation({owner,account,draftId,draft}:{owner:Address;account:Address;draftId:string;draft:BatchDraft}){
 const provider=useOkxProvider(),[status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[prepared,setPrepared]=useState<Prepared|null>(null),[hash,setHash]=useState(''),[uncertain,setUncertain]=useState(false),[confirmed,setConfirmed]=useState(false),[waiting,setWaiting]=useState(''),[polling,setPolling]=useState(false),[round,setRound]=useState(0);
 const mounted=useRef(true),lock=useRef(false),storageKey='studio:v2-setup:'+owner.toLowerCase()+':'+account.toLowerCase()+':'+draftId;
 const load=useCallback(async()=>{try{const out=await api(draftId);if(mounted.current)setStatus(out);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not check setup.');}},[draftId]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.prepared?.id){setPrepared(saved.prepared);if(/^0x[0-9a-f]{64}$/i.test(saved.hash??'')){setHash(saved.hash);setOpen(true);}else if(saved.uncertain){setUncertain(true);setOpen(true);}}}catch{}},[storageKey]);
 const observing=!!status?.active||!!status?.runs.some(r=>['pending','unknown','signed'].includes(r.state));
 useEffect(()=>{if(!observing)return;const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[observing,load]);
 async function start(stop=false){
  if(lock.current)return;lock.current=true;setOpen(true);setBusy(true);setConfirmed(false);setError('');setWaiting('Checking your group payment…');let sent=false;let request:Prepared|null=null;
  try{
   if(hash||uncertain)throw Error('Check the existing wallet request before continuing.');if(!provider)throw Error('Open OKX Wallet to continue.');
   const latest:Status=await api(draftId);if(!mounted.current)return;setStatus(latest);
   if(!stop&&latest.ready&&!latest.active){await api(draftId,'finish_setup');setConfirmed(true);setWaiting('');await load();return;}
   request=await api(draftId,'prepare_step',{stop});if(!mounted.current)return;if(!request)throw Error('Could not prepare this group step.');setPrepared(request);
   const r=request.review,tx=request.transaction;
   if(r.owner.toLowerCase()!==owner.toLowerCase()||r.account.toLowerCase()!==account.toLowerCase()||r.globalBudget!==latest.globalBudget||r.draftId!==draftId||r.step!==(stop?'revoke':latest.step))throw Error('This group setup review changed. Refresh and try again.');
   if(r.step==='executor'&&r.executor?.toLowerCase()!==latest.executor?.toLowerCase())throw Error('The payment service address changed.');
   if(r.step==='protection'&&(!r.protection||r.protection.committed!==latest.source.committed||r.protection.buffer!==latest.source.buffer||r.protection.evidence.toLowerCase()!==latest.source.hash.toLowerCase()))throw Error('Your bills or cash reserve changed. Review again.');
   const expected=groupSetupTransaction(r,draft);
   if(tx.to.toLowerCase()!==account.toLowerCase()||tx.data.toLowerCase()!==expected.data.toLowerCase()||tx.value!=='0x0'||tx.chainId!==31611)throw Error('Wallet request does not match your group payment.');
   if(!Number.isSafeInteger(request.expiresAt)||Date.now()>=request.expiresAt||request.expiresAt>Date.now()+61000)throw Error('Setup review expired. Try again.');
   await ensureSetupChain(provider);await assertSetupWallet(provider,owner);if(!mounted.current)return;
   if(Date.now()>=request.expiresAt)throw Error('Setup review expired. Try again.');
   localStorage.setItem(storageKey,JSON.stringify({prepared:request,uncertain:true}));sent=true;setWaiting('Confirm this step in OKX…');
   const result=await provider.request({method:'eth_sendTransaction',params:[{from:owner,to:account,data:expected.data,value:'0x0',chainId:'0x7b7b'}]});
   if(typeof result!=='string'||!/^0x[0-9a-f]{64}$/i.test(result))throw Error('Check OKX activity for this request.');
   localStorage.setItem(storageKey,JSON.stringify({prepared:request,hash:result}));if(mounted.current)setHash(result);
  }catch(e){const rejected=walletRequestDeclined(e);if(rejected)localStorage.removeItem(storageKey);if(mounted.current){setUncertain(sent&&!rejected);setError(setupWalletError(e,'Setting up group payments'));setWaiting('');}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 useEffect(()=>{if(!hash||!prepared||confirmed)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;setPolling(true);setError('');setWaiting('Waiting for confirmation…');
  void watchConfirmation({cancelled:()=>cancelled,sleep:ms=>new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,ms);}),check:async()=>{const out=await api(draftId,'confirm_step',{reviewId:prepared.id,txHash:hash});if(!cancelled)setStatus(out.status);},onWaiting:()=>setWaiting('Waiting for confirmation…'),onConfirmed:()=>{setConfirmed(true);setPolling(false);setWaiting('');setUncertain(false);localStorage.removeItem(storageKey);},onFailed:message=>{setError(message);setPolling(false);},onTimeout:()=>{setPolling(false);setWaiting('The network is taking longer than usual. Your transaction is saved. Check again later.');}});
  return()=>{cancelled=true;if(timer)clearTimeout(timer);wake?.();};
 },[hash,prepared,confirmed,round,draftId,storageKey]);
 function close(){setOpen(false);if(confirmed){setHash('');setPrepared(null);setConfirmed(false);setUncertain(false);void load();}}
 const paid=status?.runs.find(r=>r.state==='confirmed'),pending=status?.runs.find(r=>['signed','pending','unknown'].includes(r.state));
 const completeReceipt=!!paid&&!!status?.completed;
 const label=status?.stopped?'Stopped':pending?'Checking payment':completeReceipt?'Paid':status?.completed?'Checking payment':status?.expired?'Ended':status?.active?(status.serviceEnabled?'Scheduled':'Ready for payment service'):'Finish setup';
 return <div className="as-soft"><span className="as-status">{label}</span>{!status&&!error&&<p>Checking setup…</p>}{status?.stopped?<p>No more group payments will be sent.</p>:pending?<p>Your group transaction is being checked. Do not send another payment.</p>:completeReceipt?<p>Every recipient received the approved amount.</p>:status?.active?<p>{status.serviceEnabled?'The service will check this payment automatically.':'The group is approved. The payment service still needs to be enabled.'}</p>:status?.blocked?<p>{status.blocked}</p>:status?.step?<><p>Next: {status.label}. Each setup step needs your wallet approval and does not send a group payment.</p><button className="as-button as-primary" disabled={busy||!!hash||uncertain} onClick={()=>void start()}>{status.label}</button></>:status?.ready?<button className="as-button as-primary" disabled={busy} onClick={()=>void start()}>Finish setup</button>:null}
 {status?.approved&&!status.stopped&&!status.completed&&<button className="as-button" disabled={busy||!!hash||uncertain} onClick={()=>void start(true)}>Stop group payments</button>}
 {status?.runs.map(run=>run.txHash&&<p key={run.id}><a href={'https://explorer.test.mezo.org/tx/'+run.txHash} target="_blank" rel="noreferrer">View group transaction</a></p>)}
 {(hash||uncertain)&&!open&&<button className="as-button" onClick={()=>setOpen(true)}>View setup transaction</button>}{error&&!open&&<><p className="as-error" role="alert">{error}</p><button className="as-button" onClick={()=>{setError('');void load();}}>Refresh setup</button></>}
 <Dialog.Root open={open} onOpenChange={v=>{if(!busy){if(!v)close();else setOpen(true);}}}><Dialog.Portal><Dialog.Overlay className="as-dialog-overlay"/><Dialog.Content className="as-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}><Dialog.Title>{confirmed?(prepared?.review.step==='revoke'?'Group payments stopped':'Setup step complete'):prepared?labels[prepared.review.step]:'Set up group payments'}</Dialog.Title><Dialog.Description>{draft.name} · Total budget {formatUnits(BigInt(draft.lifetimeBudget),18)} MUSD</Dialog.Description>{!confirmed&&prepared?.review.step==='configure'&&<ul>{draft.recipients.map(r=><li key={r.address}>{formatUnits(BigInt(r.amount),18)} MUSD to <span className="as-address">{r.address}</span></li>)}</ul>}{!confirmed&&prepared?.review.protection&&<p>Keep {formatUnits(BigInt(prepared.review.protection.committed),18)} MUSD for bills and {formatUnits(BigInt(prepared.review.protection.buffer),18)} MUSD as your cash reserve.</p>}
 <p role="status" aria-live="polite" className={error?'as-error':confirmed?'as-success':'as-small'}>{error||(confirmed?'Confirmed successfully.':waiting)}</p>{uncertain&&!hash&&prepared&&<label className="as-form">Existing transaction hash from OKX<input placeholder="0x…" onChange={e=>{if(/^0x[0-9a-f]{64}$/i.test(e.target.value)){localStorage.setItem(storageKey,JSON.stringify({prepared,hash:e.target.value}));setHash(e.target.value);}}}/></label>}{hash&&<a href={'https://explorer.test.mezo.org/tx/'+hash} target="_blank" rel="noreferrer">View transaction</a>}
 <div className="as-actions">{confirmed?<button className="as-button as-primary" onClick={close}>OK</button>:<><button className="as-button" disabled={busy} onClick={close}>{hash?'Close':'Cancel'}</button>{error&&!hash&&!uncertain&&<button className="as-button" disabled={busy} onClick={()=>void start(prepared?.review.step==='revoke')}>Try again in OKX</button>}{hash&&!polling&&!error&&<button className="as-button" onClick={()=>setRound(r=>r+1)}>Check again</button>}</>}</div></Dialog.Content></Dialog.Portal></Dialog.Root></div>;
}
