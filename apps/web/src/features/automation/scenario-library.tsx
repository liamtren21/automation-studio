'use client';
import {useState} from 'react';
import {savedScenarios} from '../../../../../packages/automation/src/studio/scenarios';
import {paymentGuidance} from '../../../../../packages/automation/src/studio/readiness';
export function ScenarioLibrary(){
 const examples=savedScenarios(),[selected,setSelected]=useState(examples[0].id),example=examples.find(item=>item.id===selected)!;
 return <section className="as-card"><span className="as-kicker">SIMULATED / LEARN BY EXAMPLE</span><h2>Simulated examples</h2><p>See how limits protect a shared cash balance. No account changes, wallet request or real transfer occurs.</p><div className="as-actions" aria-label="Choose an example">{examples.map(item=><button key={item.id} className="as-button" aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>{item.title}</button>)}</div><div className="as-soft" aria-live="polite"><h3>{example.title}</h3><p>{example.description}</p><dl className="as-definition"><div><dt>Before</dt><dd>{example.before}</dd></div><div><dt>After</dt><dd>{example.after}</dd></div></dl>{example.outcomes.map(item=><p key={item.bot}><strong>{item.bot}</strong>: {paymentGuidance(item.reason).title}</p>)}<p><strong>Next step:</strong> {example.action}</p></div></section>;
}
