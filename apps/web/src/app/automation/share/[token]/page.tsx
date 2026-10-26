export const dynamic='force-dynamic';
export const revalidate=0;
export const metadata={title:'Shared schedule | Automation Studio',robots:{index:false,follow:false},referrer:'no-referrer' as const};
import {database} from '../../../../../../../packages/db/src/database';
import {formatUnits} from 'viem';
import {readAutomationShare} from '@/server/automation/shares';
import '../../automation.css';
export default async function SharedAutomation({params}:{params:Promise<{token:string}>}) {
 const {token}=await params,share=await readAutomationShare(await database(),token);
 return <div className="as-shell"><main className="as-content" style={{maxWidth:760,margin:'40px auto'}}><a href="/automation">Automation Studio</a><section className="as-card"><h1>{share?String(share.name):'This shared schedule is unavailable.'}</h1>{share?<><p>{String(share.disclosure)}</p><dl className="as-definition"><div><dt>Each payment</dt><dd>{formatUnits(BigInt(share.amount),18)} MUSD</dd></div><div><dt>Total limit</dt><dd>{formatUnits(BigInt(share.lifetimeCap),18)} MUSD</dd></div><div><dt>Recipient</dt><dd className="as-address">{String(share.recipient)}</dd></div><div><dt>Schedule</dt><dd>{new Date(Number(share.startAt)*1000).toISOString()} to {new Date(Number(share.endAt)*1000).toISOString()}</dd></div><div><dt>Interval</dt><dd>{String(share.intervalSeconds)} seconds</dd></div></dl><p>No wallet connection is needed to read this snapshot.</p></>:<p>The link may have expired or been revoked.</p>}</section></main></div>;
}
