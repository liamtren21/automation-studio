'use client';
import {setupReadiness,nextPaymentWindow,paymentGuidance,policyChanges} from '../../../../../packages/automation/src/studio/readiness';
import type {StudioPolicy} from '../../../../../packages/automation/src/studio/types';
import {date,money,type StudioView,type StudioRule} from './studio-client';
import {formatUnits} from 'viem';
import {botPresentation} from './bot-presentation';
export function SetupGuide({view,onNavigate,onContinue}:{view:StudioView;onNavigate:(tab:'settings'|'cash'|'runs')=>void;onContinue?:(checkId:string)=>void}){
 const checks=setupReadiness(view),labels={ready:'Checked',action_required:'Action needed',pending:'Pending',unknown:'Unknown'};
 const groups=[['wallet','Connect your owner wallet',['wallet']],['account','Create your payment account',['account']],['funds','Add funds and protect your cash',['funds','protection']],['service','Prepare automatic payments',['executor','gas','network','execution','service']],['transaction','Check earlier transactions',['transaction']]] as const;
 const rows=groups.map(([id,label,ids])=>({id,label,checks:checks.filter(c=>(ids as readonly string[]).includes(c.id))})).filter(g=>g.checks.length);
 const next=rows.find(g=>g.checks.some(c=>c.state!=='ready')),target=next?.checks.find(c=>c.state!=='ready')?.target;
 return <section className="as-card as-setup-guide" aria-labelledby="setup-heading"><span className="as-kicker">YOUR NEXT STEP</span><h2 id="setup-heading">{view.mode==='demo'?'Try your first payment bot':next?.label??'Your account checks are complete'}</h2><p>{view.mode==='demo'?'Use sample funds to create a bot, then run a payment. No wallet is needed.':next?.checks.find(c=>c.state!=='ready')?.detail??'Create a bot to choose a recipient, schedule and budget.'}</p>{next&&view.mode==='live'&&<button className="as-button as-primary" onClick={()=>onContinue?onContinue(next.checks.find(c=>c.state!=='ready')!.id):onNavigate(target==='cash'?'cash':target==='runs'?'runs':'settings')}>Continue setup</button>}<details><summary>View setup checklist · {rows.filter(g=>g.checks.every(c=>c.state==='ready')).length} of {rows.length} complete</summary><ol>{rows.map(g=><li key={g.id}><div><strong>{g.label}</strong>{g.checks.map(check=><p key={check.id}><span className="as-status">{labels[check.state]}</span> {check.detail}</p>)}</div></li>)}</ol></details></section>;
}
export function BotWindow({rule}:{rule:StudioRule}){
 const info=botPresentation(rule);
 return <div className="as-bot-window"><strong>{info.status}</strong><p>{info.message}</p>{info.nextAt&&<p>Next payment: <time dateTime={new Date(Number(info.nextAt)*1000).toISOString()}>{date(info.nextAt)}</time></p>}</div>;
}
const fieldNames:Record<string,string>={recipient:'Recipient',amount:'Each payment',endAt:'Schedule ends',startAt:'First payment',intervalSeconds:'Frequency (seconds)',perRunCap:'Per-run limit',perPeriodCap:'Period limit',lifetimeCap:'Total budget',priority:'Priority',enabled:'Enabled',vault:'Automation account',chainId:'Chain',policyId:'Policy ID'};
const displayChange=(field:string,value:string)=>['amount','perRunCap','perPeriodCap','lifetimeCap'].includes(field)?formatUnits(BigInt(value),18)+' MUSD':['startAt','endAt'].includes(field)?date(value):field==='intervalSeconds'?(Number(value)%86400===0?'Every '+Number(value)/86400+' days':'Every '+value+' seconds'):field==='enabled'?(value==='true'?'Enabled':'Disabled'):value;
export function VersionHistory({rule}:{rule:StudioRule}){
 if(!rule.revisions?.length)return null;
 return <details><summary>All saved permission versions · {rule.revisions.length}</summary><p>Current confirmed onchain version: {rule.onchainVersion??'not reported'}. Saved history describes previous reviews; historical status does not establish current permission.</p>{rule.revisions.map(revision=><details key={revision.version}><summary>Version {revision.version}{revision.name?' · '+revision.name:''}</summary><dl className="as-definition">{Object.entries(revision.policy).map(([field,value])=><div key={field}><dt>{field==='version'?'Version':fieldNames[field]??field}</dt><dd className={['recipient','vault','policyId'].includes(field)?'as-address':undefined}>{displayChange(field,String(value))}</dd></div>)}</dl><p className="as-address">Policy hash: {revision.configHash??'not reported'}</p></details>)}</details>;
}
export function VersionComparison({before,after}:{before?:StudioPolicy;after:StudioPolicy}){
 if(!before)return null;
 const changes=policyChanges({...before},{...after});
 return <section className="as-soft"><h3>Permission changes</h3><p>Version {before.version} → Version {after.version}. Review every changed field before approving this update.</p>{changes.length?<div className="as-table-wrap"><table><thead><tr><th>Permission</th><th>Version {before.version}</th><th>Version {after.version}</th></tr></thead><tbody>{changes.map(c=><tr key={c.field}><th scope="row">{fieldNames[c.field]??c.field}</th><td className="as-address">{displayChange(c.field,c.before)}</td><td className="as-address">{displayChange(c.field,c.after)}</td></tr>)}</tbody></table></div>:<p>No policy fields changed.</p>}<p className="as-small">Existing onchain permissions remain until a confirmed update or revocation.</p></section>;
}
