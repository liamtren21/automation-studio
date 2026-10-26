'use client';

import { useState } from 'react';
import { isAddress } from 'viem';
import { useOkxProvider } from '../../components/okx-provider';
import { assertSetupWallet, ensureSetupChain, setupWalletError } from '../../components/setup-wallet';
import { validateSignInMessage } from '../../lib/sign-in-message';

export function StudioWalletConnect({onConnected}: {onConnected: () => Promise<void>}) {
  const provider = useOkxProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setBusy(true);
    setError('');
    try {
      if (!provider) throw new Error('Enable the OKX Wallet extension or open Automation Studio in the OKX Wallet browser.');
      const accounts = await provider.request({method: 'eth_requestAccounts'});
      const address = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof address !== 'string' || !isAddress(address)) throw new Error('Select a wallet account to continue.');
      await ensureSetupChain(provider);
      await assertSetupWallet(provider, address);
      const response = await fetch(`/api/auth/challenge?address=${encodeURIComponent(address)}`, {cache: 'no-store'});
      const challenge = await response.json();
      if (!response.ok) throw new Error(challenge.error || 'Could not create a sign-in request.');
      validateSignInMessage(challenge.message, address, window.location.origin);
      await assertSetupWallet(provider, address);
      const signature = await provider.request({method: 'personal_sign', params: [challenge.message, address]});
      await assertSetupWallet(provider, address);
      const verification = await fetch('/api/auth/verify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({address, message: challenge.message, signature})});
      const result = await verification.json();
      if (!verification.ok) throw new Error(result.error || 'Wallet sign-in failed.');
      await onConnected();
    } catch (cause) {
      setError(setupWalletError(cause, 'Connecting wallet'));
    } finally {
      setBusy(false);
    }
  }

  return <div><button className="as-button as-primary" disabled={busy} onClick={() => void connect()}>{busy ? 'Connecting to OKX…' : 'Connect and sign in with OKX'}</button>{busy && <p role="status" className="as-small">Approve the network and sign-in requests in OKX. Signing in grants no payment permission.</p>}{error && <p role="alert" className="as-error">{error}</p>}</div>;
}
