// Jendela persetujuan untuk permintaan dari situs (dApp).

import * as W from '../wallet.js';
import * as S from '../solana.js';
import { local, session } from '../storage.js';
import { V, state, $, esc, short, render, busy, conn, net, keypair, address, activeAcc, friendlyError } from '../ui.js';

const b64e = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const TITLES = {
  connect: 'Permintaan koneksi',
  signIn: 'Masuk dengan Solana',
  signMessage: 'Tanda tangani pesan',
  signTransaction: 'Setujui transaksi',
  signAllTransactions: 'Setujui transaksi',
  signAndSendTransaction: 'Setujui transaksi',
};

async function respond(req, payload) {
  await session.remove(`req:${req.id}`);
  try {
    await chrome.tabs.sendMessage(req.tabId, { type: 'dapp-response', id: req.replyId, ...payload }, { frameId: req.frameId });
  } catch {
    /* tab sudah ditutup */
  }
  window.close();
}

const reject = (req) => respond(req, { error: { code: 4001, message: 'User rejected the request.' } });

function siteHeader(req) {
  const host = new URL(req.origin).host;
  const insecure = req.origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(req.origin);
  return `<div class="site">
    ${req.favicon && /^https:/.test(req.favicon) ? `<img src="${esc(req.favicon)}" alt="" referrerpolicy="no-referrer">` : '<span class="avatar">🌐</span>'}
    <div><b>${esc(host)}</b><small>${esc(req.title.slice(0, 60))}</small></div>
  </div>
  ${insecure ? '<p class="warn">Situs ini tidak memakai HTTPS. Berhati-hatilah.</p>' : ''}`;
}

function layout(req, body, approveLabel = 'Setujui') {
  return `<header class="bar"><span></span><h2>${esc(TITLES[req.method] || 'Permintaan')}</h2><span></span></header>
    <div class="pad">
      ${siteHeader(req)}
      ${body}
      <p class="error" id="err"></p>
    </div>
    <div class="footer">
      <button class="btn" id="no">Tolak</button>
      <button class="btn primary" id="yes">${esc(approveLabel)}</button>
    </div>`;
}

function accountCard() {
  return `<div class="card"><div class="kv"><span>Akun</span><b>${esc(activeAcc().name)} · <span class="mono">${short(address())}</span></b></div>
    <div class="kv"><span>Jaringan</span><b>${net().label}</b></div></div>`;
}

async function markConnected(origin) {
  const sites = (await local.get('connectedSites')) || {};
  sites[origin] = { connectedAt: Date.now() };
  await local.set('connectedSites', sites);
}

const accountResult = () => ({ address: address(), chain: net().chain });

V.approve = async function viewApprove(id) {
  const req = await session.get(`req:${id}`);
  if (!req) {
    return render(
      `<div class="center hero"><p>Permintaan sudah tidak berlaku.</p><button class="btn" id="close">Tutup</button></div>`,
      () => ($('#close').onclick = () => window.close()),
    );
  }
  const handler = HANDLERS[req.method];
  if (!handler) return reject(req);
  handler(req);
};

const HANDLERS = {
  connect(req) {
    render(
      layout(
        req,
        `<p>Situs ini ingin terhubung ke dompet Anda.</p>
        ${accountCard()}
        <ul class="perm">
          <li>✓ Melihat alamat & saldo akun aktif</li>
          <li>✓ Meminta persetujuan transaksi</li>
          <li>✕ Tidak bisa memindahkan dana tanpa persetujuan Anda</li>
        </ul>`,
        'Hubungkan',
      ),
      () => {
        $('#no').onclick = () => reject(req);
        $('#yes').onclick = async () => {
          await markConnected(req.origin);
          respond(req, { result: accountResult() });
        };
      },
    );
  },

  signMessage(req) {
    const bytes = b64d(req.params.message || '');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const printable = !/[\u0000-\u0008\u000e-\u001f�]/.test(text);
    render(
      layout(
        req,
        `<p class="muted">Menandatangani pesan <b>tidak</b> memindahkan dana dan tidak memakan biaya.</p>
        <div class="msg">${printable ? esc(text) : `<span class="mono">${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}</span>`}</div>
        ${accountCard()}`,
        'Tanda tangani',
      ),
      () => {
        $('#no').onclick = () => reject(req);
        $('#yes').onclick = () => {
          const sig = W.signMessage(keypair(), bytes);
          respond(req, { result: { signature: b64e(sig) } });
        };
      },
    );
  },

  signIn(req) {
    const host = new URL(req.origin).host;
    const input = req.params.input || {};
    const domainMismatch = input.domain && input.domain !== host;
    const addrMismatch = input.address && input.address !== address();
    const msg = W.createSignInMessageText({
      ...input,
      domain: host,
      address: address(),
      chainId: input.chainId || undefined,
    });
    render(
      layout(
        req,
        `${domainMismatch ? `<p class="warn bad">Domain di pesan (${esc(input.domain)}) berbeda dengan situs ini. Kemungkinan PHISHING — permintaan diblokir.</p>` : ''}
        ${addrMismatch ? '<p class="warn">Situs meminta akun lain. Ganti akun aktif di dompet bila perlu.</p>' : ''}
        <p>Masuk ke <b>${esc(host)}</b> dengan akun Solana Anda.</p>
        <div class="msg">${esc(msg)}</div>
        ${accountCard()}`,
        'Masuk',
      ),
      () => {
        $('#no').onclick = () => reject(req);
        if (domainMismatch || addrMismatch) $('#yes').disabled = true;
        $('#yes').onclick = async () => {
          const bytes = new TextEncoder().encode(msg);
          const sig = W.signMessage(keypair(), bytes);
          await markConnected(req.origin);
          respond(req, { result: { ...accountResult(), signedMessage: b64e(bytes), signature: b64e(sig) } });
        };
      },
    );
  },

  signTransaction: (req) => transactions(req),
  signAllTransactions: (req) => transactions(req),
  signAndSendTransaction: (req) => transactions(req),
};

async function transactions(req) {
  const me = address();
  let txs;
  try {
    txs = (req.params.transactions || []).map((t) => S.decodeTransaction(b64d(t)));
    if (!txs.length) throw new Error('Tidak ada transaksi.');
  } catch (e) {
    return respond(req, { error: { code: -32602, message: `Transaksi tidak valid: ${e.message}` } });
  }
  for (const vtx of txs) {
    const signers = vtx.message.staticAccountKeys.slice(0, vtx.message.header.numRequiredSignatures).map((k) => k.toBase58());
    if (!signers.includes(me)) {
      return respond(req, { error: { code: 4100, message: 'Transaksi tidak memerlukan tanda tangan akun aktif.' } });
    }
  }
  const send = req.method === 'signAndSendTransaction';
  const chainMismatch = req.params.chain && req.params.chain !== net().chain;

  render(
    layout(
      req,
      `${chainMismatch ? `<p class="warn bad">Situs meminta jaringan ${esc(req.params.chain.split(':')[1])}, tapi dompet sedang di ${net().label}. Ganti jaringan di Pengaturan.</p>` : ''}
      ${txs
        .map((vtx, i) => {
          const items = S.describeTransaction(vtx);
          return `<div class="card tx">
            ${txs.length > 1 ? `<small>Transaksi ${i + 1} dari ${txs.length}</small>` : ''}
            <div class="kv"><span>Perkiraan perubahan saldo</span><b id="sim${i}">Mensimulasikan…</b></div>
            <ul class="ixs">${items
              .map((it) => `<li class="${it.warn ? 'bad' : ''}">${esc(it.text || `Interaksi dengan ${it.programName || short(it.program)}`)}</li>`)
              .join('')}</ul>
          </div>`;
        })
        .join('')}
      ${accountCard()}
      ${net().test ? '' : '<p class="muted small">Periksa dengan teliti. Transaksi di Mainnet tidak bisa dibatalkan.</p>'}`,
      send ? 'Setujui & kirim' : 'Setujui',
    ),
    () => {
      $('#no').onclick = () => reject(req);
      if (chainMismatch) $('#yes').disabled = true;
      $('#yes').onclick = async () => {
        busy($('#yes'), true, send ? 'Mengirim…' : 'Menandatangani…');
        $('#no').disabled = true;
        try {
          const kp = keypair();
          const signatures = [];
          for (const vtx of txs) {
            vtx.sign([kp]);
            const idx = vtx.message.staticAccountKeys.findIndex((k) => k.equals(kp.publicKey));
            signatures.push(vtx.signatures[idx]);
          }
          if (send) {
            const opts = req.params.options || {};
            const c = conn();
            const sigs = [];
            for (const vtx of txs) {
              sigs.push(
                await c.sendRawTransaction(vtx.serialize(), {
                  skipPreflight: Boolean(opts.skipPreflight),
                  preflightCommitment: opts.preflightCommitment || 'confirmed',
                  maxRetries: opts.maxRetries ?? 3,
                }),
              );
            }
            state.portfolio = null;
            respond(req, { result: { signatures: sigs } });
          } else {
            respond(req, {
              result: {
                signedTransactions: txs.map((t) => b64e(t.serialize())),
                signatures: signatures.map((s) => b64e(s)),
              },
            });
          }
        } catch (e) {
          busy($('#yes'), false);
          $('#no').disabled = false;
          $('#err').textContent = friendlyError(e);
        }
      };
    },
  );

  // Simulasi (async, tidak menghalangi tampilan)
  const c = conn();
  txs.forEach(async (vtx, i) => {
    try {
      const r = await S.simulateBalanceChange(c, vtx, me);
      const el = $(`#sim${i}`);
      if (!el) return;
      if (r.err) {
        el.textContent = 'Simulasi gagal — transaksi kemungkinan akan gagal';
        el.className = 'bad';
      } else if (r.deltaLamports != null) {
        const d = r.deltaLamports;
        el.textContent = `${d > 0 ? '+' : ''}${S.formatSol(d)} SOL`;
        el.className = d < 0 ? 'neg' : 'pos';
      } else {
        el.textContent = 'Tidak diketahui';
      }
    } catch {
      const el = $(`#sim${i}`);
      if (el) el.textContent = 'Tidak bisa disimulasikan';
    }
  });
}
