'use client';
import {useState} from 'react';
import type {StudioRule} from './studio-client';
export function ScheduleSharing({rules,mode,selectedId}:{rules:StudioRule[];mode:'demo'|'live';selectedId?:string}) {
 const [id,setId]=useState(selectedId??''),[consent,setConsent]=useState(false),[result,setResult]=useState<{token:string;path:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function request(action:'create'|'revoke'){
  setBusy(true);setError('');try{const r=await fetch('/api/automation/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,action,policyId:id,consent,token:result?.token})});const data=await r.json();if(!r.ok)throw new Error(data.error);setResult(action==='revoke'?null:data);}catch(e){setError(e instanceof Error?e.message:'Could not update this share.');}finally{setBusy(false);}
 }
 if(!rules.length)return null;
 return <section className="as-card"><h2>Share a payment schedule</h2><p>Share the recipient, amount and dates with someone else. The link lasts 24 hours and does not confirm a payment.</p><div className="as-form">{!selectedId&&<label>Schedule<select value={id} onChange={e=>{setId(e.target.value);setConsent(false);}}><option value="">Choose a schedule</option>{rules.map(r=><option key={r.policy.policyId} value={r.policy.policyId}>{r.name}</option>)}</select></label>}<label className="as-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I agree to make this recipient, amount and schedule visible to anyone with the link.</label><div className="as-actions"><button className="as-button" disabled={!id||!consent||busy||!!result} onClick={()=>void request('create')}>Create read-only link</button>{result&&<button className="as-button" disabled={busy} onClick={()=>void request('revoke')}>Revoke this link</button>}</div>{result&&<p role="status"><a href={result.path} target="_blank" rel="noreferrer">Open shared schedule</a><span className="as-address">{typeof window!=='undefined'?window.location.origin:''}{result.path}</span></p>}{error&&<p role="alert" className="as-error">{error}</p>}</div></section>;
}
