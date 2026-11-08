import { Account, Asset, BASE_FEE, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { normalizeHash, stroops } from './requests.js';
import { reconcile } from './reconcile.js';

export const HORIZON = 'https://horizon-testnet.stellar.org';

export class HorizonError extends Error {
  constructor(status, detail) {
    const codes = detail?.extras?.result_codes;
    const reason = codes?.operations?.join(', ') || codes?.transaction || detail?.title;
    super(reason ? `Stellar Testnet rejected the request (${reason}).` : `Stellar Testnet returned HTTP ${status}.`);
    this.status = status;
    this.codes = codes;
  }
}

async function horizon(path, init) {
  const response = await fetch(HORIZON + path, { ...init, signal: AbortSignal.timeout(25_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HorizonError(response.status, data);
  if (!data) throw new Error('Stellar Testnet returned an unreadable response.');
  return data;
}

export async function getAccount(address) {
  try {
    return await horizon('/accounts/' + encodeURIComponent(address));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export function nativeBalance(account) {
  return account?.balances?.find((balance) => balance.asset_type === 'native')?.balance ?? '0';
}

export async function fundAccount(address) {
  const response = await fetch('https://friendbot.stellar.org/?' + new URLSearchParams({ addr: address }), {
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok && !(await getAccount(address))) {
    throw new Error('Friendbot could not fund this account. Try again in a moment.');
  }
  return getAccount(address);
}

export function buildPayment(account, request) {
  if (account.account_id === request.recipient) throw new Error('Use a different wallet to pay this request.');
  if (stroops(nativeBalance(account)) < stroops(request.amount) + BigInt(BASE_FEE)) {
    throw new Error('This wallet does not have enough Testnet XLM for the amount and fee.');
  }

  return new TransactionBuilder(new Account(account.account_id, account.sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: request.recipient, asset: Asset.native(), amount: request.amount }))
    .addMemo(Memo.text(request.memo))
    .setTimeout(180)
    .build();
}

export function transactionHash(transaction) {
  return Array.from(transaction.hash(), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function submitPayment(signedXdr, expectedHash) {
  const envelope = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  if (transactionHash(envelope) !== expectedHash || !envelope.signatures.length) {
    throw new Error('The wallet returned an unexpected or unsigned transaction.');
  }
  return horizon('/transactions', { method: 'POST', body: new URLSearchParams({ tx: signedXdr }) });
}

export async function verifyPayment(request, rawHash) {
  const hash = normalizeHash(rawHash);
  const path = '/transactions/' + hash;
  const transaction = await horizon(path);
  if (transaction.hash !== hash) throw new Error('Stellar Testnet returned a different transaction hash.');
  if (transaction.successful !== true) return reconcile(request, transaction, []);

  const operations = [];
  let cursor = '';
  do {
    const params = new URLSearchParams({ limit: '200', order: 'asc', cursor });
    const page = await horizon(path + '/operations?' + params);
    const records = page._embedded.records;
    operations.push(...records);
    if (operations.length >= transaction.operation_count) break;
    const nextCursor = records.at(-1)?.paging_token;
    if (!nextCursor || nextCursor === cursor) throw new Error('The transaction operations are still incomplete. Try again.');
    cursor = nextCursor;
  } while (true);

  return reconcile(request, transaction, operations);
}
