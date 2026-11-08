import { disconnect, getAddress, getNetwork, isConnected, requestAccess, signTransaction } from '@stellar/varial-sdk';
import { Networks } from '@stellar/stellar-sdk';

function unwrap(result) {
  if (result.error) throw new Error(result.error.message || 'The wallet declined the request.');
  return result;
}

export async function assertWallet(expectedAddress) {
  const network = unwrap(await getNetwork());
  if (network.networkPassphrase !== Networks.TESTNET) {
    throw new Error('Switch Freighter / Varial to Testnet and try again.');
  }
  if (expectedAddress && unwrap(await getAddress()).address !== expectedAddress) {
    throw new Error('The active wallet changed. Disconnect and reconnect to continue.');
  }
}

export async function connectWallet() {
  const { isConnected: installed } = await isConnected();
  if (!installed) throw new Error('Install the Freighter / Varial browser extension to connect.');
  const { address } = unwrap(await requestAccess());
  if (!address) throw new Error('Unlock Freighter / Varial and approve access to connect.');
  await assertWallet(address);
  return address;
}

export async function disconnectWallet() {
  unwrap(await disconnect());
}

export async function signPayment(transaction, address) {
  await assertWallet(address);
  const result = unwrap(await signTransaction(transaction.toXDR(), {
    address,
    networkPassphrase: Networks.TESTNET,
  }));
  if (!result.signedTxXdr) throw new Error('The wallet did not sign this payment.');
  return result.signedTxXdr;
}
