export const MUSD_DECIMALS = 18;
export const MUSD_SCALE = 10n ** 18n;
export const MAX_UINT256 = 2n ** 256n - 1n;
export function baseUnits(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Expected canonical base unit string');
  const amount = BigInt(value);
  if (amount > MAX_UINT256) throw new Error('Amount exceeds uint256');
  return amount;
}
export function parseMusd(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) throw new Error('Expected unsigned MUSD decimal with at most 18 fractional digits');
  const [whole, fraction = ''] = value.split('.');
  return baseUnits((BigInt(whole!) * MUSD_SCALE + BigInt(fraction.padEnd(18, '0'))).toString());
}
export interface DisplayOptions { minimumFractionDigits?: number; maximumFractionDigits?: number }
/** Fractional display precision truncates; accounting retains all base units. */
export function formatMusd(amount: bigint, options: DisplayOptions = {}): string {
  baseUnits(amount.toString());
  const min = options.minimumFractionDigits ?? 0, max = options.maximumFractionDigits ?? 18;
  if (![min, max].every(n => Number.isInteger(n) && n >= 0 && n <= 18) || min > max) throw new Error('Invalid display precision');
  let fraction = (amount % MUSD_SCALE).toString().padStart(18, '0').slice(0, max).replace(/0+$/, '');
  fraction = fraction.padEnd(min, '0');
  return `${amount / MUSD_SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function available(balance: bigint, reserved: bigint): bigint {
  baseUnits(balance.toString()); baseUnits(reserved.toString());
  if (reserved > balance) throw new Error('Reserved amount exceeds balance');
  return balance - reserved;
}
export function surplus(balance: bigint, reserved: bigint, buffer: bigint): bigint {
  baseUnits(buffer.toString()); const free = available(balance, reserved);
  return free > buffer ? free - buffer : 0n;
}
export interface CashSnapshot { balanceBaseUnits: string; reservedBaseUnits: string; operatingBufferBaseUnits: string }
export function cashPosition(input: CashSnapshot): { availableBaseUnits: string; surplusBaseUnits: string } {
  const balance = baseUnits(input.balanceBaseUnits), reserved = baseUnits(input.reservedBaseUnits), buffer = baseUnits(input.operatingBufferBaseUnits);
  return { availableBaseUnits: available(balance,reserved).toString(), surplusBaseUnits: surplus(balance,reserved,buffer).toString() };
}
