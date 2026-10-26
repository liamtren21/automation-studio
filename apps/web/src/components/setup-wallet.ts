export type SetupProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, cb: () => void) => void;
  removeListener?: (event: string, cb: () => void) => void;
};

// Wallet providers can reject with plain objects rather than Error instances.
function errorDetails(error: unknown, depth = 0): { message?: string; code?: number } {
  if (depth > 4 || !error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : undefined };
  }
  const value = error as Record<string, unknown>;
  const nested = [value.cause, value.error,
    value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>).originalError : undefined];
  const details = nested.map(item => errorDetails(item, depth + 1));
  const code = typeof value.code === 'number' ? value.code : details.find(item => item.code !== undefined)?.code;
  const message = [typeof value.message === 'string' ? value.message : '',
    ...details.map(item => item.message || '')].filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).join(' — ');
  return { code, message: message || undefined };
}

export function setupWalletError(error: unknown, stage: string, sendRequested = false): string {
  const { code, message } = errorDetails(error);
  const detail = message || 'The wallet did not return an error description.';
  const hint = code === 4001 ? 'The wallet request was declined.'
    : code === -32002 ? 'A wallet request is already open. Open your wallet extension to finish it.'
    : code === 4902 ? 'Add Mezo Testnet (31611) in your wallet, then continue.'
    : code === 4900 || code === 4901 ? 'Reconnect your wallet to Mezo Testnet.' : '';
  const uncertain = sendRequested && code !== 4001
    ? 'Check wallet activity for a pending or submitted deployment before trying again.' : '';
  return [`${stage}${code === undefined ? '' : ` (wallet code ${code})`}: ${detail}`, hint, uncertain].filter(Boolean).join(' ');
}

function isMezoChain(chain: unknown): boolean {
  return typeof chain === 'string' && /^0x[0-9a-f]+$/i.test(chain) && BigInt(chain) === 31611n;
}

export async function assertSetupWallet(p: SetupProvider, owner: string): Promise<void> {
  const accounts = await p.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Your wallet account changed. Connect and review again.');
  }
  if (!isMezoChain(await p.request({ method: 'eth_chainId' }))) {
    throw new Error('Your wallet network changed. Select Mezo Testnet and review again.');
  }
}

export async function ensureSetupChain(p: SetupProvider): Promise<void> {
  if (isMezoChain(await p.request({ method: 'eth_chainId' }))) return;
  const switchChain = () => p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7b7b' }] });
  try {
    await switchChain();
  } catch (error) {
    if (errorDetails(error).code !== 4902) throw error;
    await p.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: '0x7b7b', chainName: 'Mezo Testnet',
      nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
      rpcUrls: ['https://rpc.test.mezo.org'],
      blockExplorerUrls: ['https://explorer.test.mezo.org'],
    }] });
    // Adding a network does not imply that the wallet switched to it.
    if (!isMezoChain(await p.request({ method: 'eth_chainId' }))) await switchChain();
  }
  if (!isMezoChain(await p.request({ method: 'eth_chainId' }))) {
    throw new Error('Switch your wallet to Mezo Testnet (31611).');
  }
}
