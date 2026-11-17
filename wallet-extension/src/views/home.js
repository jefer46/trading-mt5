import QRCode from 'qrcode';
import * as S from '../solana.js';
import {
  V, state, $, $$, esc, short, render, toast, copy, busy, conn, net, address, touch,
  header, bindHeader, simpleHeader, loadPortfolio, fiat, tokenValue, solValue, tokenLabel, avatar, friendlyError,
} from '../ui.js';

let tab = 'tokens';

V.home = async function viewHome() {
  touch();
  const addr = address();
  const cached = state.portfolio?.address === addr && state.portfolio.network === state.settings.network;
  render(
    `${header()}
    <div class="pad">
      <button class="addr" id="copy" title="Salin alamat">${short(addr)} ⧉</button>
      <div class="balance"><span id="bal">…</span> <small>SOL</small></div>
      <div class="fiat center" id="fiat"></div>
      <div class="actions">
        <button class="act" id="recv"><span>↓</span>Terima</button>
        <button class="act" id="send"><span>↑</span>Kirim</button>
        <button class="act" id="swap"><span>⇄</span>Swap</button>
        <button class="act" id="stake"><span>◈</span>Stake</button>
        ${net().test ? '<button class="act" id="drop"><span>☂</span>Airdrop</button>' : ''}
      </div>
      <div class="seg tabs">
        <button data-t="tokens">Token</button><button data-t="nfts">NFT</button><button data-t="activity">Aktivitas</button>
        <button class="refresh" id="refresh" title="Muat ulang">⟳</button>
      </div>
      <div id="list" class="list"><p class="muted center">Memuat…</p></div>
    </div>`,
    () => {
      bindHeader();
      $('#copy').onclick = () => copy(addr, 'Alamat disalin');
      $('#recv').onclick = V.receive;
      $('#send').onclick = () => V.send({});
      $('#swap').onclick = () => V.swap({});
      $('#stake').onclick = V.stake;
      $('#refresh').onclick = () => {
        state.portfolio = null;
        V.home();
      };
      if ($('#drop')) $('#drop').onclick = () => doAirdrop(addr);
      $$('.tabs [data-t]').forEach((b) => {
        b.classList.toggle('on', b.dataset.t === tab);
        b.onclick = () => {
          tab = b.dataset.t;
          $$('.tabs [data-t]').forEach((x) => x.classList.toggle('on', x === b));
          renderTab();
        };
      });
    },
  );

  if (cached) {
    renderBalance();
    renderTab();
  }
  try {
    await loadPortfolio();
    if (!$('#bal') || state.portfolio.address !== address()) return;
    renderBalance();
    if (tab !== 'activity' || !cached) renderTab();
  } catch (e) {
    if ($('#bal') && !cached) {
      $('#bal').textContent = '—';
      $('#list').innerHTML = `<p class="muted center">${esc(friendlyError(e))}</p>`;
    }
    toast('Gagal terhubung ke RPC', 'err');
  }
};

function renderBalance() {
  const p = state.portfolio;
  $('#bal').textContent = S.formatSol(p.lamports);
  if (p.prices) {
    const total = (solValue(p.lamports) || 0) + p.tokens.reduce((s, t) => s + (t.isNft ? 0 : tokenValue(t) || 0), 0);
    $('#fiat').textContent = `Total ${fiat(total)}`;
  }
}

function renderTab() {
  if (tab === 'tokens') renderTokens();
  else if (tab === 'nfts') renderNfts();
  else loadActivity();
}

function renderTokens() {
  const list = $('#list');
  const p = state.portfolio;
  if (!list || !p) return;
  const fungible = p.tokens
    .filter((t) => !t.isNft)
    .sort((a, b) => (tokenValue(b) || 0) - (tokenValue(a) || 0));
  const solRow = `<button class="row" data-sol>
      <span class="avatar sol">◎</span>
      <span class="grow"><b>Solana</b><small>${S.formatSol(p.lamports)} SOL</small></span>
      <span class="right">${p.prices ? `<b>${fiat(solValue(p.lamports))}</b><small>${fiat(p.prices.sol)}</small>` : ''}</span>
    </button>`;
  list.innerHTML =
    solRow +
    fungible
      .map((t, i) => {
        const v = tokenValue(t);
        return `<button class="row" data-tok="${i}">
          ${avatar(t)}
          <span class="grow"><b>${esc(t.name || tokenLabel(t))}</b><small>${S.formatUnits(t.amountRaw, t.decimals, 6)} ${esc(tokenLabel(t))}</small></span>
          <span class="right">${v != null ? `<b>${fiat(v)}</b>` : ''}</span>
        </button>`;
      })
      .join('') +
    (fungible.length ? '' : '<p class="muted center small">Belum ada token SPL.</p>');
  $('[data-sol]').onclick = () => V.send({});
  $$('[data-tok]').forEach((b) => (b.onclick = () => V.token(fungible[Number(b.dataset.tok)])));
}

function renderNfts() {
  const list = $('#list');
  const nfts = state.portfolio?.tokens.filter((t) => t.isNft) || [];
  if (!list) return;
  list.innerHTML = nfts.length
    ? `<div class="grid">${nfts
        .map(
          (n, i) => `<button class="nft" data-nft="${i}">
            ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph">🖼</span>'}
            <span>${esc(n.name || short(n.mint))}</span></button>`,
        )
        .join('')}</div>`
    : '<p class="muted center">Belum ada NFT.</p>';
  $$('[data-nft]').forEach((b) => (b.onclick = () => V.nft(nfts[Number(b.dataset.nft)])));
}

async function loadActivity() {
  const list = $('#list');
  list.innerHTML = '<p class="muted center">Memuat…</p>';
  try {
    const sigs = await S.getActivity(conn(), address());
    if (!$('#list') || tab !== 'activity') return;
    list.innerHTML = sigs.length
      ? sigs
          .map((s) => {
            const when = s.blockTime ? new Date(s.blockTime * 1000).toLocaleString('id-ID') : '';
            return `<a class="row" target="_blank" rel="noopener" href="${S.explorerUrl('tx', s.signature, state.settings.network)}">
              <span class="avatar sm ${s.err ? 'bad' : ''}">${s.err ? '✕' : '✓'}</span>
              <span class="grow"><b>${short(s.signature)}</b><small>${esc(when)}</small></span><small>${s.err ? 'Gagal' : 'Sukses'}</small></a>`;
          })
          .join('')
      : '<p class="muted center">Belum ada aktivitas.</p>';
  } catch {
    if ($('#list')) list.innerHTML = '<p class="muted center">Gagal memuat aktivitas.</p>';
  }
}

async function doAirdrop(addr) {
  const btn = $('#drop');
  busy(btn, true, '…');
  try {
    await S.requestAirdrop(conn(), addr, 1);
    toast('Airdrop 1 SOL berhasil');
    state.portfolio = null;
    V.home();
  } catch (e) {
    busy(btn, false);
    toast(/429|limit|faucet/i.test(e.message) ? 'Batas airdrop tercapai. Coba faucet.solana.com' : 'Airdrop gagal', 'err');
  }
}

// ---------- Detail token ----------

V.token = function viewToken(t) {
  const v = tokenValue(t);
  render(
    `${simpleHeader(tokenLabel(t))}
    <div class="pad center">
      ${avatar(t, 'lg')}
      <div class="balance">${S.formatUnits(t.amountRaw, t.decimals)} <small>${esc(tokenLabel(t))}</small></div>
      ${v != null ? `<div class="fiat">${fiat(v)}</div>` : ''}
      <div class="card left">
        <div class="kv"><span>Nama</span><b>${esc(t.name || '—')}</b></div>
        <div class="kv"><span>Mint</span><button class="link mono" id="mint">${short(t.mint)} ⧉</button></div>
        <div class="kv"><span>Program</span><b>${t.programId === S.PROGRAMS.token2022 ? 'Token-2022' : 'SPL Token'}</b></div>
      </div>
      <div class="actions">
        <button class="act" id="send"><span>↑</span>Kirim</button>
        <button class="act" id="swap"><span>⇄</span>Swap</button>
        <a class="act" target="_blank" rel="noopener" href="${S.explorerUrl('address', t.mint, state.settings.network)}"><span>↗</span>Explorer</a>
      </div>
    </div>`,
    () => {
      $('#back').onclick = V.home;
      $('#mint').onclick = () => copy(t.mint, 'Alamat mint disalin');
      $('#send').onclick = () => V.send({ mint: t.mint });
      $('#swap').onclick = () => V.swap({ inputMint: t.mint });
    },
  );
};

V.nft = function viewNft(n) {
  const attrs = (n.attributes || []).filter((a) => a && a.trait_type != null);
  render(
    `${simpleHeader(n.name || 'NFT')}
    <div class="pad">
      ${n.image ? `<img class="nft-img" src="${esc(n.image)}" alt="" referrerpolicy="no-referrer">` : '<div class="nft-img ph">🖼</div>'}
      ${n.description ? `<p class="muted">${esc(n.description)}</p>` : ''}
      ${attrs.length ? `<div class="attrs">${attrs.map((a) => `<div><small>${esc(a.trait_type)}</small><b>${esc(a.value)}</b></div>`).join('')}</div>` : ''}
      <div class="card">
        <div class="kv"><span>Mint</span><button class="link mono" id="mint">${short(n.mint)} ⧉</button></div>
      </div>
      <button class="btn primary" id="send">Kirim NFT</button>
      <a class="btn" target="_blank" rel="noopener" href="${S.explorerUrl('address', n.mint, state.settings.network)}">Lihat di Explorer ↗</a>
    </div>`,
    () => {
      $('#back').onclick = () => {
        tab = 'nfts';
        V.home();
      };
      $('#mint').onclick = () => copy(n.mint, 'Alamat mint disalin');
      $('#send').onclick = () => V.send({ mint: n.mint });
    },
  );
};

// ---------- Terima ----------

V.receive = async function viewReceive() {
  const addr = address();
  const qr = await QRCode.toDataURL(addr, { margin: 1, width: 220, color: { dark: '#111', light: '#fff' } });
  render(
    `${header('Terima')}
    <div class="pad center">
      <img class="qr" src="${qr}" alt="QR alamat">
      <p class="mono">${addr}</p>
      <p class="muted">Hanya kirim SOL, token, dan NFT jaringan Solana (${net().label}) ke alamat ini.</p>
      <button class="btn primary" id="copy">Salin alamat</button>
      <button class="btn" id="back">Kembali</button>
    </div>`,
    () => {
      bindHeader();
      $('#copy').onclick = () => copy(addr, 'Alamat disalin');
      $('#back').onclick = V.home;
    },
  );
};
