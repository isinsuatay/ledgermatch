import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp,
  ClipboardCheck, Copy, Fingerprint, Layers3, Link2, ListChecks, Plus, Radio, ShieldCheck, Wallet, X,
} from 'lucide-react';
import { createRequest, formatXlm, normalizeHash, requestFromHash, requestUrl, stroops } from './requests.js';
import { buildPayment, fundAccount, getAccount, nativeBalance, submitPayment, transactionHash, verifyPayment } from './stellar.js';
import { assertWallet, connectWallet, disconnectWallet, signPayment } from './wallet.js';
import { loadWorkspace, saveWorkspace, updateEntry } from './workspace.js';
import './style.css';

const short = (value) => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—';
const EXPLORER = 'https://stellar.expert/explorer/testnet/tx/';
const emptyDraft = { title: '', recipient: '', amount: '' };

function importRequest(workspace) {
  try {
    const request = requestFromHash(window.location.hash);
    if (request) {
      const existing = workspace.entries.find((entry) => entry.request.memo === request.memo);
      if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) {
        throw new Error('This reference already belongs to a different request in this workspace.');
      }
      return { workspace: updateEntry(workspace, request), error: '' };
    }
    return { workspace, error: '' };
  } catch {
    return { workspace, error: 'This payment link is invalid or conflicts with an existing request.' };
  }
}

function App() {
  const [initial] = useState(() => importRequest(loadWorkspace()));
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [wallet, setWallet] = useState(null);
  const [notice, setNotice] = useState(initial.error ? { tone: 'error', text: initial.error } : null);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(!initial.workspace.selected);
  const [hashInput, setHashInput] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);

  const active = workspace.entries.find((entry) => entry.request.memo === workspace.selected);
  const request = active?.request;
  const proof = active?.proof;
  const pending = active?.pending;

  useEffect(() => setStorageAvailable(saveWorkspace(workspace)), [workspace]);
  useEffect(() => {
    const onHash = () => {
      setWorkspace((current) => importRequest(current).workspace);
      const incoming = importRequest({ entries: [] });
      if (incoming.workspace.selected) setCreating(false);
      if (incoming.error) setNotice({ tone: 'error', text: incoming.error });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function announce(tone, text) {
    setNotice({ tone, text });
  }

  async function run(label, action) {
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      announce('error', error.message || 'Something went wrong. Try again.');
    } finally {
      setBusy('');
    }
  }

  function select(entry) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setWorkspace((current) => ({ ...current, selected: entry.request.memo }));
    setHashInput('');
    setCreating(false);
    setNotice(null);
  }

  function addRequest(event) {
    event.preventDefault();
    try {
      const item = createRequest(draft);
      setWorkspace((current) => updateEntry(current, item));
      setDraft(emptyDraft);
      setHashInput('');
      setCreating(false);
      announce('success', 'Payment request created. Share its link with the payer.');
    } catch (error) {
      announce('error', error.message);
    }
  }

  async function connect() {
    const address = await connectWallet();
    setWallet({ address, account: await getAccount(address) });
    announce('success', 'Wallet connected to Stellar Testnet.');
  }

  async function disconnect() {
    setWallet(null);
    try {
      await disconnectWallet();
      announce('success', 'Wallet disconnected and site access revoked.');
    } catch {
      announce('info', 'Wallet disconnected here. To revoke site access, remove LedgerMatch from the wallet’s Allow List.');
    }
  }

  async function checkReceipt(rawHash) {
    const hash = normalizeHash(rawHash);
    const result = await verifyPayment(request, hash);
    setWorkspace((current) => {
      const entry = current.entries.find((item) => item.request.memo === request.memo);
      return updateEntry(current, request, {
        proof: entry?.proof?.matched && !result.matched ? entry.proof : result,
        pending: entry?.pending?.hash === hash ? null : entry?.pending,
      });
    });
    announce(result.matched ? 'success' : 'error', result.matched
      ? 'Payment matched. Every ledger check passed.'
      : result.ambiguous ? 'Multiple identical payment operations found. The match is ambiguous.'
        : 'The transaction does not match this request. Review the ledger checks.');
  }

  async function pay() {
    if (!wallet || !request || pending || proof?.matched) return;
    await assertWallet(wallet.address);
    const [sender, recipient] = await Promise.all([getAccount(wallet.address), getAccount(request.recipient)]);
    if (!sender) throw new Error('Fund your wallet with Testnet XLM before paying.');
    if (!recipient) throw new Error('The recipient account needs to be funded on Testnet first.');
    const transaction = buildPayment(sender, request);
    const hash = transactionHash(transaction);
    const signed = await signPayment(transaction, wallet.address);

    const submission = { hash, expiresAt: Number(transaction.timeBounds.maxTime) * 1000 };
    const next = updateEntry(workspace, request, { pending: submission });
    setStorageAvailable(saveWorkspace(next));
    setWorkspace(next);
    setHashInput(hash);

    try {
      await submitPayment(signed, hash);
    } catch (error) {
      if (error.status === 400 && error.codes?.transaction) {
        setWorkspace((current) => updateEntry(current, request, { pending: null }));
        throw error;
      }
      announce('info', 'Submission is unconfirmed. Check the saved hash before sending again.');
      return;
    }
    try {
      await checkReceipt(hash);
    } catch {
      announce('info', 'Stellar accepted the transaction. Verify the saved hash once Horizon indexes its operations.');
    }
    getAccount(wallet.address).then((account) => {
      setWallet((current) => current?.address === wallet.address ? { ...current, account } : current);
    }).catch(() => {});
  }

  async function verify() {
    try {
      await checkReceipt(hashInput || pending?.hash || '');
    } catch (error) {
      if (error.status !== 404) throw error;
      throw new Error('This transaction is not indexed on Testnet yet. Double-check the hash and try again.');
    }
  }

  async function releaseExpired() {
    if (!pending || Date.now() < pending.expiresAt + 60_000) return;
    try {
      await checkReceipt(pending.hash);
    } catch (error) {
      if (error.status !== 404) throw error;
      // Confirm the network is reachable and has closed a ledger after the transaction expired.
      const response = await fetch('https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1', {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Could not establish ledger freshness. Try again.');
      const latest = (await response.json())._embedded.records[0];
      if (!(Date.parse(latest.closed_at) > pending.expiresAt)) {
        throw new Error('Horizon has not indexed a ledger beyond the payment deadline yet.');
      }
      try {
        await checkReceipt(pending.hash);
      } catch (secondError) {
        if (secondError.status !== 404) throw secondError;
        setWorkspace((current) => updateEntry(current, request, { pending: null }));
        announce('info', 'The submission expired without a ledger record. You can try the payment again.');
      }
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(requestUrl(request));
    announce('success', 'Payment link copied.');
  }

  const status = proof?.matched ? 'Matched' : pending ? 'In flight' : 'Awaiting payment';

  return (
    <>
      <header className="topbar">
        <div className="frame top-inner">
          <a className="brand" href={window.location.pathname}>
            <img src={import.meta.env.BASE_URL + 'mark.svg'} alt="" />
            <span>LedgerMatch<small>PAYMENT OPERATIONS</small></span>
          </a>
          <div className="top-actions">
            <span className="network"><Radio size={15} /> Stellar Testnet</span>
            <button className="btn top-wallet" disabled={!!busy} onClick={() => run(wallet ? 'Disconnecting…' : 'Connecting…', wallet ? disconnect : connect)}>
              <Wallet size={16} /> {wallet ? 'Disconnect wallet' : 'Connect wallet'}
            </button>
          </div>
        </div>
      </header>

      <main className="frame">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow hero-label"><span /> STELLAR / RECONCILIATION WORKSPACE</span>
            <h1 id="hero-title">Every payment.<br /><em>Accounted for.</em></h1>
            <p>Create a payment request, collect XLM, and match the ledger receipt to the right record.</p>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="graphic-grid" />
            <div className="graphic-label"><Activity size={15} /> LEDGER SIGNAL <span>01 / 01</span></div>
            <div className="graphic-track"><div><Fingerprint size={28} /></div><i /><div><Layers3 size={27} /></div><i /><div className="graphic-match"><Check size={29} /></div></div>
            <div className="graphic-caption"><span>REQUEST</span><span>LEDGER</span><span>VERIFIED</span></div>
          </div>
        </section>

        <section className="wallet-strip" aria-label="Connected wallet and balance">
          <div className="wallet-id"><span className="icon-tile"><Wallet size={20} /></span><div><b>{wallet ? short(wallet.address) : 'Wallet disconnected'}</b><small title={wallet?.address}>{wallet ? 'Freighter / Varial · Testnet' : 'Connect Freighter / Varial to send a payment'}</small></div></div>
          <div className="wallet-balance"><small>TESTNET BALANCE</small><b>{wallet ? formatXlm(stroops(nativeBalance(wallet.account)) ?? 0n) : '—'} <span>XLM</span></b></div>
          {wallet && <button className="btn quiet" disabled={!!busy} onClick={() => run(wallet.account ? 'Refreshing…' : 'Funding account…', async () => {
            await assertWallet(wallet.address);
            const account = await (wallet.account ? getAccount(wallet.address) : fundAccount(wallet.address));
            setWallet({ ...wallet, account });
            announce(account ? 'success' : 'info', account ? 'Testnet balance updated.' : 'Account funding is still being indexed. Check again in a moment.');
          })}>{wallet.account ? 'Refresh balance' : 'Get Testnet XLM'}</button>}
        </section>

        <div className="desk-title">
          <div><span className="eyebrow"><span /> YOUR WORKSPACE</span><h2>Payment desk</h2></div>
          <button className="btn secondary" disabled={!!busy || creating} onClick={() => { setCreating(true); setNotice(null); }}>
            <Plus size={17} /> New request
          </button>
        </div>

        {(!storageAvailable || notice || busy) && <div className={'notice ' + (busy ? 'info' : notice?.tone || 'info')} role="status">
          {busy ? <Activity size={17} /> : notice?.tone === 'success' ? <Check size={17} /> : <CircleHelp size={17} />}
          <span>{busy || notice?.text || 'Browser storage is unavailable. Save your payment link and transaction hash before closing this tab.'}</span>
        </div>}

        <div className="desk">
          <aside className="card register" aria-label="Request register">
            <div className="card-heading"><span className="icon-tile"><Layers3 size={18} /></span><div><h3>Request register</h3><small>{workspace.entries.length} saved in this browser</small></div></div>
            {workspace.entries.length === 0 ? <div className="register-empty"><ListChecks size={23} /><p>New requests appear here.</p><small>Each has its own payment reference.</small></div> : (
              <ul className="request-list">{workspace.entries.map((entry) => (
                <li key={entry.request.memo}>
                  <button className={'request-item ' + (!creating && workspace.selected === entry.request.memo ? 'active' : '')} disabled={!!busy} onClick={() => select(entry)}>
                    <span><b>{entry.request.title}</b><small>{entry.proof?.matched ? 'Matched' : entry.pending ? 'In flight' : 'Open'} · {entry.request.amount} XLM</small></span><ChevronRight size={16} />
                  </button>
                </li>
              ))}</ul>
            )}
          </aside>

          {creating || !request ? (
            <section className="card form-card">
              <div className="card-heading"><span className="icon-tile"><ArrowDownLeft size={19} /></span><div><h3>Create a payment request</h3><small>Give the payer a link with the amount and reference prefilled.</small></div></div>
              <form onSubmit={addRequest} className="card-body">
                <label>Request name<input required maxLength={64} placeholder="e.g. Workshop seat · A014" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                <label>Recipient address<input required maxLength={56} placeholder="G…" spellCheck="false" value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} /></label>
                {wallet && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, recipient: wallet.address })}>Use connected wallet</button>}
                <label>Amount in XLM<input required inputMode="decimal" placeholder="0.00" maxLength={20} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></label>
                <div className="form-actions">
                  {request && <button type="button" className="btn quiet" onClick={() => setCreating(false)}><ArrowLeft size={16} /> Back</button>}
                  <button className="btn primary" disabled={!!busy}>Create request <ArrowRight size={17} /></button>
                </div>
              </form>
            </section>
          ) : (
            <div className="detail-stack">
              <section className="card">
                <div className="card-heading"><span className="icon-tile"><ArrowDownLeft size={19} /></span><div><h3>{request.title}</h3><small>Native XLM · Stellar Testnet</small></div><span className={'badge ' + (proof?.matched ? 'matched' : '')}>{status}</span></div>
                <div className="card-body">
                  <div className="amount-display">{request.amount} <span>XLM</span></div>
                  <dl className="request-meta"><div><dt>RECIPIENT</dt><dd>{request.recipient}</dd></div><div><dt>REFERENCE MEMO</dt><dd>{request.memo}</dd></div></dl>
                  <div className="form-actions">
                    <button className="btn secondary" disabled={!!busy} onClick={() => run('Copying link…', copyLink)}><Link2 size={17} /> Copy payment link</button>
                    <button className="btn primary" disabled={!!busy || !!pending || !!proof?.matched || wallet?.address === request.recipient} onClick={() => run(wallet ? 'Waiting for wallet / ledger…' : 'Connecting…', wallet ? pay : connect)}>
                      {wallet ? 'Pay with Freighter' : 'Connect to pay'} <ArrowUpRight size={17} />
                    </button>
                  </div>
                  {wallet?.address === request.recipient && <p className="field-hint">This is the recipient wallet. Switch accounts, then reconnect to pay.</p>}
                </div>
              </section>

              <section className="card receipt">
                <div className="card-heading"><span className="icon-tile"><ClipboardCheck size={19} /></span><div><h3>Ledger receipt</h3><small>Verify a payment against this request’s ledger record.</small></div></div>
                <div className="card-body">
                  {pending && <p className="field-hint pending"><Activity size={16} /> A submission is pending. Verify its hash before trying again.</p>}
                  <form className="verify-form" onSubmit={(event) => { event.preventDefault(); run('Checking the ledger…', verify); }}>
                    <label>Transaction hash<input value={hashInput} onChange={(event) => setHashInput(event.target.value)} maxLength={64} spellCheck="false" placeholder={pending?.hash || 'Paste a Testnet transaction hash'} /></label>
                    <button className="btn secondary" disabled={!!busy}>Verify <ArrowRight size={16} /></button>
                  </form>
                  {pending && <button className="text-button" disabled={!!busy} onClick={() => run('Checking submission expiry…', async () => {
                    if (Date.now() < pending.expiresAt + 60_000) throw new Error('Wait until one minute after the transaction deadline before clearing the pending state.');
                    await releaseExpired();
                  })}>Check for expired submission</button>}
                  {proof && <div className={'proof ' + (proof.matched ? 'proof-ok' : 'proof-fail')}>
                    <div className="proof-title"><b>{proof.matched ? 'Payment matched' : 'Payment mismatch'}</b><span>Ledger #{proof.ledger}</span></div>
                    <ul>{proof.checks.map(({ name, pass }) => <li key={name}>{pass ? <Check size={16} /> : <X size={16} />}{name}<small>{pass ? 'Passed' : 'Failed'}</small></li>)}</ul>
                    <div className="proof-hash"><a href={EXPLORER + proof.hash} target="_blank" rel="noreferrer" title={proof.hash}>{short(proof.hash)} <ArrowUpRight size={14} /></a><button type="button" className="text-button" disabled={!!busy} onClick={() => run('Copying hash…', async () => { await navigator.clipboard.writeText(proof.hash); announce('success', 'Transaction hash copied.'); })}><Copy size={14} /> Copy hash</button></div>
                  </div>}
                </div>
              </section>
            </div>
          )}
        </div>

        <footer><span><ShieldCheck size={16} /> Testnet only · Signatures stay in your wallet</span><span>LEDGERMATCH / WHITE BELT</span></footer>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
