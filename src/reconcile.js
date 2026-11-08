import { stroops } from './requests.js';

export function reconcile(request, transaction, operations) {
  const payments = operations.filter((operation) => operation.type === 'payment' && operation.asset_type === 'native');
  const recipientPayments = payments.filter((operation) => operation.to === request.recipient && !operation.to_muxed);
  const exact = recipientPayments.filter((operation) => stroops(operation.amount) === stroops(request.amount));
  const checks = [
    { name: 'Ledger confirmation', pass: transaction.successful === true },
    { name: 'Reference memo', pass: transaction.memo_type === 'text' && transaction.memo === request.memo },
    { name: 'Recipient address', pass: recipientPayments.length > 0 },
    { name: 'Exact XLM amount', pass: exact.length === 1 },
  ];
  return {
    checks,
    matched: checks.every(({ pass }) => pass),
    hash: transaction.hash,
    ledger: transaction.ledger,
    confirmedAt: transaction.created_at,
    ambiguous: exact.length > 1,
  };
}
