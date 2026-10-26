'use client';
import { useEffect, useState } from 'react';
import type { SetupProvider } from './setup-wallet';

type Injected = SetupProvider & { isOkxWallet?: boolean; isOKExWallet?: boolean; providers?: Injected[] };
const usable = (value: unknown): value is Injected => Boolean(value && typeof (value as Injected).request === 'function');

/** Deliberately never falls back to an unlabelled window.ethereum provider. */
export function injectedOkxProvider(scope: { okxwallet?: unknown; ethereum?: Injected }): SetupProvider | null {
  if (usable(scope.okxwallet)) return scope.okxwallet;
  const candidates = scope.ethereum?.providers ?? (scope.ethereum ? [scope.ethereum] : []);
  return candidates.find(p => usable(p) && (p.isOkxWallet === true || p.isOKExWallet === true)) ?? null;
}

export function useOkxProvider(): SetupProvider | null {
  const [selected, setSelected] = useState<SetupProvider | null>(null);
  useEffect(() => {
    let pinned: SetupProvider | null = null;
    const select = (candidate: SetupProvider | null) => {
      if (!pinned && candidate) { pinned = candidate; setSelected(candidate); }
    };
    const detect = () => select(injectedOkxProvider(window as unknown as Parameters<typeof injectedOkxProvider>[0]));
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { rdns?: string }; provider?: unknown }>).detail;
      if (['com.okex.wallet', 'com.okx.wallet'].includes(detail?.info?.rdns ?? '') && usable(detail?.provider)) select(detail.provider);
    };
    // Namespace is preferred. EIP-6963 supports extensions injected after hydration.
    detect();
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.addEventListener('ethereum#initialized', detect);
    const timer = window.setInterval(detect, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('eip6963:announceProvider', announce);
      window.removeEventListener('ethereum#initialized', detect);
    };
  }, []);
  return selected;
}
