'use client';

import { useState } from 'react';
import { formatUnits } from 'viem';
import { studioApi } from './studio-client';

export function ProtectionSettings({source, onSaved, onReview}: {onReview?: () => void; source: {committedBills: string; buffer: string;manualCommitments?:string}; onSaved: () => Promise<void>}) {
  const [committedBills, setCommittedBills] = useState(formatUnits(BigInt(source.manualCommitments??source.committedBills), 18));
  const [cashCushion, setCashCushion] = useState(formatUnits(BigInt(source.buffer), 18));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      await studioApi('live', 'protection_settings', {committedBills, cashCushion});
      await onSaved(); setSaved(true); setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your cash plan.');
    } finally { setBusy(false); }
  }

  return <section className="as-card"><h2>Your cash protection plan</h2><p>Open obligation records are included automatically. Add only extra commitments here to avoid counting an obligation twice; then review the onchain protection update.</p><form className="as-form" onSubmit={event => {event.preventDefault(); void save();}}><div className="as-form-grid"><label>Additional manual commitments (MUSD)<input required type="number" min="0" step="any" value={committedBills} onChange={event => {setCommittedBills(event.target.value); setSaved(false); setDirty(true);}}/></label><label>Cash cushion (MUSD)<input required type="number" min="0" step="any" value={cashCushion} onChange={event => {setCashCushion(event.target.value); setSaved(false); setDirty(true);}}/></label></div><button className="as-button" disabled={busy}>{busy ? 'Saving…' : 'Save cash plan'}</button></form><button type="button" className="as-button as-primary" disabled={busy || dirty || !onReview} onClick={onReview}>Review updated cash protection</button>{dirty && <p role="status" className="as-small">Save your changed cash plan before reviewing it in OKX.</p>}{!onReview && <p className="as-small">Create your automation account before applying protection onchain.</p>}<p className="as-small">Saving updates your plan. Use “Review updated cash protection” to approve the limits onchain before they protect payments.</p>{saved && <p role="status" className="as-success">Cash plan saved. Review updated cash protection to apply it onchain.</p>}{error && <p role="alert" className="as-error">{error}</p>}</section>;
}
