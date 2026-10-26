import { getAddress, isAddress } from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

const statement = 'Sign in to Automation Studio. This signature does not authorize payments or token access.';
export const SIGN_IN_LIFETIME_MS = 300000;

export function createSignInMessage(address: string, origin: string, nonce: string, issuedAt = new Date()) {
 const url = new URL(origin);
 if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid sign-in origin.');
 return createSiweMessage({ address: getAddress(address), chainId: 31611, domain: url.host, uri: url.origin, version: '1', nonce, issuedAt, expirationTime: new Date(issuedAt.getTime() + SIGN_IN_LIFETIME_MS), statement });
}

/** Shared browser/server check before requesting a signature or accepting a session. */
export function validateSignInMessage(message: unknown, address: string, origin: string, now = new Date()) {
 const invalid = () => { throw new Error('Sign-in message does not match this wallet, deployment, network or expiry.'); };
 if (typeof message !== 'string' || message.length > 2000 || !isAddress(address)) return invalid();
 const url = new URL(origin), parsed = parseSiweMessage(message);
 if (!validateSiweMessage({ message: parsed, address: getAddress(address), domain: url.host, time: now }) ||
  parsed.chainId !== 31611 || parsed.version !== '1' || parsed.uri !== url.origin ||
  parsed.statement !== statement || !parsed.nonce || !/^[a-zA-Z0-9]{8,}$/.test(parsed.nonce) ||
  !parsed.issuedAt || !parsed.expirationTime || !Number.isFinite(parsed.issuedAt.getTime()) ||
  parsed.issuedAt.getTime() > now.getTime() + 30000 ||
  parsed.expirationTime.getTime() - parsed.issuedAt.getTime() !== SIGN_IN_LIFETIME_MS) return invalid();
 // viem's parser returns recognized fields; canonical equality also rejects extra,
 // duplicated or unparsed text and optional permissions our sign-in never issues.
 if (createSignInMessage(address, url.origin, parsed.nonce, parsed.issuedAt) !== message) return invalid();
 return parsed;
}
