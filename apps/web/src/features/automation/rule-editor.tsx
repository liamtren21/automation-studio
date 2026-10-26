'use client';
import {useState} from 'react';
import type {StudioRule} from './studio-client';
import type {LiveIntent} from './transaction-review';
export function RuleEditor({rules,onEdit,onRelease,mode}:{rules:StudioRule[];onEdit:(rule:StudioRule)=>void;onRelease:(intent:LiveIntent)=>void;mode:'demo'|'live'}) {
 const [id,setId]=useState(''),[amount,setAmount]=useState('1');const rule=rules.find(r=>r.policy.policyId===id);
 if(!rules.length)return null;
 return <section className="as-card"><h2>Change a payment’s limits</h2><p>Changes create a new review. Past spending and paid periods stay counted. A different first-payment date or frequency needs a new rule.</p><div className="as-form"><label>Payment to change<select value={id} onChange={e=>setId(e.target.value)}><option value="">Choose a payment</option>{rules.map(r=><option value={r.policy.policyId} key={r.policy.policyId}>{r.name}</option>)}</select></label><button className="as-button" disabled={!rule} onClick={()=>rule&&onEdit(rule)}>Edit recipient and limits</button>{mode==='live'&&rule&&<><label>Unused budget to release (MUSD)<input type="number" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="as-button" onClick={()=>onRelease({operation:'release',policyId:id,amount})}>Review unused budget release</button></>}</div></section>;
}
