import { StrKey } from '@stellar/stellar-sdk';

const SCALE = 10_000_000n;
const MAX_STROOPS = 9_223_372_036_854_775_807n;

export function stroops(value) {
  const match = /^(\d{1,12})(?:\.(\d{1,7}))?$/.exec(String(value).trim());
  if (!match) return null;
  const units = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(7, '0'));
  return units <= MAX_STROOPS ? units : null;
}

export function formatXlm(units) {
  const fraction = String(units % SCALE).padStart(7, '0').replace(/0+$/, '');
  return `${units / SCALE}${fraction ? '.' + fraction : ''}`;
}

export function parseRequest(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const recipient = typeof input?.recipient === 'string' ? input.recipient.trim() : '';
  const amount = stroops(input?.amount);
  if (!title || title.length > 64) throw new Error('Enter a request name of 1–64 characters.');
  if (!StrKey.isValidEd25519PublicKey(recipient)) throw new Error('Enter a valid Stellar G-address.');
  if (amount === null || amount <= 0n) throw new Error('Enter a positive XLM amount with up to seven decimal places.');
  if (typeof input.memo !== 'string' || !/^LM-[0-9A-F]{20}$/.test(input.memo)) {
    throw new Error('This request has an invalid payment reference.');
  }
  return { title, recipient, amount: formatXlm(amount), memo: input.memo };
}

export function createRequest(input) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const memo = 'LM-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return parseRequest({ ...input, memo });
}

export function requestUrl(request, currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  url.hash = new URLSearchParams({ request: JSON.stringify(request) }).toString();
  return url.href;
}

export function requestFromHash(hash) {
  const raw = new URLSearchParams(hash.slice(1)).get('request');
  return raw === null ? null : parseRequest(JSON.parse(raw));
}

export function normalizeHash(value) {
  const hash = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Enter the full 64-character Stellar transaction hash.');
  return hash;
}
