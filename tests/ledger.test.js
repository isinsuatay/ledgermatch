import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { createRequest, requestFromHash, requestUrl, stroops } from '../src/requests.js';
import { reconcile } from '../src/reconcile.js';
import { buildPayment, transactionHash } from '../src/stellar.js';

const sender = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const request = createRequest({ title: 'Workshop seat', recipient, amount: '12.3400000' });
const transaction = { successful: true, memo_type: 'text', memo: request.memo };
const payment = { type: 'payment', asset_type: 'native', to: recipient, amount: '12.3400000' };

test('request links round-trip title, recipient, exact amount and memo', () => {
  const url = new URL(requestUrl(request, 'https://example.com/ledgermatch/'));
  assert.equal(url.pathname, '/ledgermatch/');
  assert.deepEqual(requestFromHash(url.hash), request);
  assert.equal(request.amount, '12.34');
  assert.notEqual(createRequest(request).memo, request.memo);
});

test('invalid links and invalid decimal precision fail closed', () => {
  assert.throws(() => requestFromHash('#request=%7B%7D'));
  assert.throws(() => createRequest({ ...request, recipient: 'G'.repeat(56) }));
  assert.throws(() => createRequest({ ...request, amount: '0.00000001' }));
  assert.equal(stroops('922337203685.4775807'), 9223372036854775807n);
  assert.equal(stroops('922337203685.4775808'), null);
});

test('ledger proof accepts native XLM with equivalent decimals', () => {
  assert.equal(reconcile(request, transaction, [payment]).matched, true);
});

test('identical payment amounts for two requests remain distinct by memo', () => {
  const secondRequest = createRequest(request);
  const result = reconcile(secondRequest, transaction, [payment]);
  assert.equal(result.matched, false);
  assert.deepEqual(result.checks.map((check) => check.pass), [true, false, true, true]);
});

test('failed, wrong asset, wrong recipient, wrong amount and ambiguous operations do not settle a request', () => {
  assert.equal(reconcile(request, { ...transaction, successful: false }, [payment]).matched, false);
  for (const variant of [
    { asset_type: 'credit_alphanum4' }, { to: sender }, { amount: '12.3400001' },
    { type: 'path_payment_strict_send' }, { to_muxed: 'muxed-address' },
  ]) {
    assert.equal(reconcile(request, transaction, [{ ...payment, ...variant }]).matched, false);
  }
  const duplicate = reconcile(request, transaction, [payment, payment]);
  assert.equal(duplicate.matched, false);
  assert.equal(duplicate.ambiguous, true);
});

test('payment envelope contains the intended native operation and reference', () => {
  const account = { account_id: sender, sequence: '10', balances: [{ asset_type: 'native', balance: '50.0000000' }] };
  const tx = TransactionBuilder.fromXDR(buildPayment(account, request).toXDR(), Networks.TESTNET);
  assert.match(transactionHash(tx), /^[0-9a-f]{64}$/);
  assert.equal(transactionHash(tx), Buffer.from(tx.hash()).toString('hex'));
  assert.equal(tx.source, sender);
  assert.equal(tx.sequence, '11');
  assert.equal(new TextDecoder().decode(tx.memo.value), request.memo);
  assert.equal(tx.operations[0].destination, recipient);
  assert.equal(tx.operations[0].asset.isNative(), true);
  assert.equal(tx.operations[0].amount, '12.3400000');
  assert.throws(() => buildPayment(account, { ...request, recipient: sender }));
  assert.throws(() => buildPayment(account, { ...request, amount: '50' }));
});
