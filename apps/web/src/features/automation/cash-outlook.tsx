'use client';
import {useState} from 'react';
import {money,date,type StudioView} from './studio-client';
import type {PortfolioDay} from '../../../../../packages/automation/src/studio/portfolio';

const dayDate=(at:string,offset=0)=>new Date((Number(at)+offset*86400)*1000).toISOString().slice(0,10);
const dayIndex=(value:string,now:string)=>Math.round((Date.parse(`${value}T00:00:00Z`)-Date.parse(`${dayDate(now)}T00:00:00Z`))/86400000);
// Hypothetical accounting can be negative or exceed uint256; it is never a transfer amount.
const scenarioMoney=(value:string)=>{const n=BigInt(value),absolute=n<0n?-n:n,whole=(absolute/10n**18n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),fraction=(absolute%10n**18n).toString().padStart(18,'0').slice(0,2);return `${n<0n?'-':''}${whole}.${fraction}`;};

export function AutomationCashOutlook({view,mode}:{view:StudioView;mode:'demo'|'live'}) {
 const now=view.account?.now??'0';
 const [expense,setExpense]=useState('0'),[day,setDay]=useState('0'),[income,setIncome]=useState('0'),[incomeDate,setIncomeDate]=useState(()=>dayDate(now)),[delay,setDelay]=useState('7'),[repayment,setRepayment]=useState('0'),[repaymentDate,setRepaymentDate]=useState(()=>dayDate(now));
 const [result,setResult]=useState<{base:StudioView;rows:PortfolioDay[]}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 function changed(){setDirty(true);}
 async function simulate(){
  if(!view.account)return;
  setBusy(true);setError('');
  try{
   const params=new URLSearchParams({mode,extraExpense:expense,expenseDay:day,expectedIncome:income,incomeDay:String(dayIndex(incomeDate,now)),incomeDelayDays:delay,repaymentExpense:repayment,repaymentDay:String(dayIndex(repaymentDate,now))});
   const r=await fetch(`/api/automation?${params}`,{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not calculate this scenario.');
   setResult({base:view,rows:d.portfolio});setDirty(false);
  }catch(e){setError(e instanceof Error?e.message:'Could not calculate this scenario.');}finally{setBusy(false);}
 }
 const data=result?.base===view?result.rows:view.portfolio??[],breach=data.find(d=>d.belowFloor),delayedBreach=data.find(d=>d.delayedIncomeBelowFloor),closing=data.at(-1),stale=result!==null&&result.base!==view;
 if(!view.account)return null;
 return <section id="cash-projection" className="as-card">
  <h2>Your next 30 days</h2>
  <p>Active schedules share existing cash and approved allocations. Compare a customer payment arriving on time or late, and include a possible repayment. Expected income never funds an automated run.</p>
  <form onSubmit={e=>{e.preventDefault();void simulate();}}>
   <div className="as-form-grid">
    <label>Extra expense (MUSD)<input value={expense} onChange={e=>{setExpense(e.target.value);changed();}} type="number" min="0" step="0.000000000000000001" required disabled={busy}/></label>
    <label>Expense: days from now<input value={day} onChange={e=>{setDay(e.target.value);changed();}} type="number" min="0" max="29" step="1" required disabled={busy}/></label>
    <label>Expected customer payment (MUSD)<input value={income} onChange={e=>{setIncome(e.target.value);changed();}} type="number" min="0" step="0.000000000000000001" required disabled={busy}/></label>
    <label>Expected receipt date (UTC)<input value={incomeDate} onChange={e=>{setIncomeDate(e.target.value);changed();}} type="date" min={dayDate(now)} max={dayDate(now,29)} required disabled={busy}/></label>
    <label>Income delay to compare (days)<input value={delay} onChange={e=>{setDelay(e.target.value);changed();}} type="number" min="0" max="90" step="1" required disabled={busy}/></label>
    <label>Possible repayment expense (MUSD)<input value={repayment} onChange={e=>{setRepayment(e.target.value);changed();}} type="number" min="0" step="0.000000000000000001" required disabled={busy}/></label>
    <label>Possible repayment date (UTC)<input value={repaymentDate} onChange={e=>{setRepaymentDate(e.target.value);changed();}} type="date" min={dayDate(now)} max={dayDate(now,29)} required disabled={busy}/></label>
   </div>
   <button className="as-button" disabled={busy} type="submit">{busy?'Calculating…':'Compare cash scenarios'}</button>
  </form>
  <p className="as-small">Scenario only. No transaction is sent, no funds move, and no permissions change. Both income comparisons subtract the same payments allowed by existing cash; they do not assume extra automated runs. A receipt delayed beyond this forecast is excluded.</p>
  {(dirty||stale)&&<p role="status" className="as-small">Recalculate to apply {stale?'the latest account changes':'your changed inputs'}.</p>}
  {closing&&<div className="as-form-grid" aria-label="Closing cash comparison">
   <div><strong>Existing cash after expenses and allowed runs</strong><p>{money(closing.balance)} MUSD</p></div>
   <div><strong>Hypothetical: customer pays on time</strong><p>{scenarioMoney(closing.hypotheticalBalance??closing.balance)} MUSD</p></div>
   <div><strong>Hypothetical: customer pays late</strong><p>{scenarioMoney(closing.delayedIncomeBalance??closing.balance)} MUSD</p></div>
  </div>}
  {breach&&<p role="status" className="as-error">Existing cash falls below the protected floor on {date(breach.at)}. Payments may stop sooner to preserve allocations and the floor.</p>}
  {delayedBreach&&<p role="status" className="as-small">The delayed income scenario falls below the protected floor on {date(delayedBreach.at)}. A negative hypothetical balance shows an uncovered expense.</p>}
  {error&&<p role="alert">{error}</p>}
  <details><summary>View daily cash and payments</summary><div className="as-table-wrap"><table><thead><tr><th>Date</th><th>Existing cash</th><th>Income on time (hypothetical)</th><th>Income delayed (hypothetical)</th><th>Allowed payments</th><th>Blocked runs</th></tr></thead><tbody>{data.map(d=><tr key={d.at}><td>{date(d.at)}</td><td>{money(d.balance)} MUSD</td><td>{scenarioMoney(d.hypotheticalBalance??d.balance)} MUSD</td><td>{scenarioMoney(d.delayedIncomeBalance??d.balance)} MUSD</td><td>{money(d.paid)} MUSD</td><td>{d.blocked}</td></tr>)}</tbody></table></div></details>
 </section>;
}
