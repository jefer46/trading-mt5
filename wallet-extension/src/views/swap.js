import * as S from '../solana.js';
import * as M from '../market.js';
import {
  V, state, $, $$, esc, short, render, busy, conn, net, keypair, address,
  header, bindHeader, loadPortfolio, tokenLabel, friendlyError,
} from '../ui.js';

const SLIPPAGES = [50, 100, 300];

function tokenOptions() {
  const p = state.portfolio;
  const out = new Map();
  out.set(S.WSOL_MINT, { mint: S.WSOL_MINT, symbol: 'SOL', decimals: 9, amountRaw: String(p.lamports) });
  for (const t of p.tokens.filter((x) => !x.isNft)) out.set(t.mint, t);
  for (const [mint, k] of Object.entries(S.KNOWN_TOKENS)) if (!out.has(mint)) out.set(mint, { mint, ...k, amountRaw: '0' });
  return out;
}

/** prefill: { inputMint } */
V.swap = async function viewSwap(prefill = {}) {
  if (net().test) {
    return render(
      `${header('Swap')}
      <div class="pad center">
        <div class="logo">⇄</div>
        <p>Swap memakai Jupiter dan hanya tersedia di <b>Mainnet</b>.</p>
        <p class="muted">Token di Devnet/Testnet tidak punya pasar. Ganti jaringan di Pengaturan bila ingin swap dengan dana sungguhan.</p>
        <button class="btn" id="back">Kembali</button>
      </div>`,
      () => {
        bindHeader();
        $('#back').onclick = V.home;
      },
    );
  }
  if (!state.portfolio || state.portfolio.address !== address()) {
    render(`${header('Swap')}<div class="pad"><p class="muted center">Memuat saldo…</p></div>`, bindHeader);
    try {
      await loadPortfolio();
    } catch (e) {
      return render(`${header('Swap')}<div class="pad"><p class="error">${esc(friendlyError(e))}</p></div>`, bindHeader);
    }
  }
  const tokens = tokenOptions();
  const held = [...tokens.values()].filter((t) => BigInt(t.amountRaw) > 0n);
  const inputMint = tokens.has(prefill.inputMint) ? prefill.inputMint : S.WSOL_MINT;
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const defaultOut = inputMint === USDC ? S.WSOL_MINT : USDC;
  let slippage = 50;
  let quote = null;
  let outToken = tokens.get(defaultOut);

  const opt = (t, sel) =>
    `<option value="${esc(t.mint)}" ${t.mint === sel ? 'selected' : ''}>${esc(tokenLabel(t))}${BigInt(t.amountRaw) > 0n ? ` — ${S.formatUnits(t.amountRaw, t.decimals, 6)}` : ''}</option>`;

  render(
    `${header('Swap')}
    <div class="pad">
      <label>Dari
        <div class="inline">
          <select class="input" id="from">${held.map((t) => opt(t, inputMint)).join('')}</select>
          <input class="input" id="amt" inputmode="decimal" placeholder="0.0">
        </div>
      </label>
      <button class="icon swapdir" id="flip" title="Tukar arah">⇅</button>
      <label>Ke
        <select class="input" id="to">
          ${[...tokens.values()].map((t) => opt(t, defaultOut)).join('')}
          <option value="custom">Token lain (tempel alamat mint)…</option>
        </select>
      </label>
      <input class="input mono hidden" id="customMint" placeholder="Alamat mint token tujuan" spellcheck="false">
      <div class="row-inline"><span class="muted">Slippage</span>
        <div class="seg small">${SLIPPAGES.map((s) => `<button data-s="${s}" class="${s === slippage ? 'on' : ''}">${s / 100}%</button>`).join('')}</div>
      </div>
      <div class="card hidden" id="quote"></div>
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Dapatkan harga</button>
      <p class="muted small center">Rute terbaik dari Jupiter. Harga dapat berubah sebelum transaksi dikonfirmasi.</p>
    </div>`,
    () => {
      bindHeader();
      const reset = () => {
        quote = null;
        $('#quote').classList.add('hidden');
        $('#go').textContent = 'Dapatkan harga';
        $('#err').textContent = '';
      };
      $('#amt').oninput = reset;
      $('#from').onchange = reset;
      $('#customMint').oninput = reset;
      $('#to').onchange = () => {
        $('#customMint').classList.toggle('hidden', $('#to').value !== 'custom');
        reset();
      };
      $('#flip').onclick = () => {
        const f = $('#from').value;
        const t = $('#to').value;
        if (t === 'custom' || !held.some((h) => h.mint === t)) return ($('#err').textContent = 'Anda tidak memiliki token tujuan untuk ditukar balik.');
        $('#from').value = t;
        $('#to').value = f;
        reset();
      };
      $$('[data-s]').forEach((b) => {
        b.onclick = () => {
          slippage = Number(b.dataset.s);
          $$('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
          reset();
        };
      });

      $('#go').onclick = async () => {
        const btn = $('#go');
        $('#err').textContent = '';
        const from = tokens.get($('#from').value);
        try {
          if (!quote) {
            let outMint = $('#to').value;
            if (outMint === 'custom') {
              outMint = $('#customMint').value.trim();
              if (!S.isValidAddress(outMint)) throw new Error('Alamat mint tidak valid.');
              busy(btn, true, 'Memeriksa token…');
              const info = await S.getMintInfo(conn(), outMint);
              outToken = { mint: outMint, decimals: info.decimals, symbol: short(outMint), amountRaw: '0' };
              busy(btn, false);
            } else {
              outToken = tokens.get(outMint);
            }
            if (outToken.mint === from.mint) throw new Error('Token asal dan tujuan sama.');
            const amountRaw = S.parseUnits($('#amt').value.replace(/,/g, ''), from.decimals);
            if (amountRaw <= 0n) throw new Error('Masukkan jumlah.');
            const reserve = from.mint === S.WSOL_MINT ? 10_000_000n : 0n; // sisakan ±0.01 SOL untuk biaya
            if (amountRaw + reserve > BigInt(from.amountRaw)) throw new Error(from.mint === S.WSOL_MINT ? 'Saldo tidak cukup (sisakan ±0.01 SOL untuk biaya).' : 'Saldo tidak cukup.');
            busy(btn, true, 'Mencari rute…');
            quote = await M.getQuote({ inputMint: from.mint, outputMint: outToken.mint, amountRaw, slippageBps: slippage });
            busy(btn, false);
            showQuote(from, outToken, quote);
            btn.textContent = 'Swap';
            return;
          }
          busy(btn, true, 'Menyiapkan…');
          const vtx = await M.getSwapTransaction(quote, address());
          if (vtx.message.staticAccountKeys[0].toBase58() !== address()) throw new Error('Transaksi dari Jupiter tidak cocok dengan akun Anda.');
          vtx.sign([keypair()]);
          btn.textContent = 'Mengirim…';
          const sig = await S.sendSigned(conn(), vtx);
          state.portfolio = null;
          V.done({
            title: 'Swap berhasil',
            subtitle: `${S.formatUnits(quote.inAmount, from.decimals, 6)} ${tokenLabel(from)} → ${S.formatUnits(quote.outAmount, outToken.decimals, 6)} ${tokenLabel(outToken)}`,
            sig,
          });
        } catch (e) {
          busy(btn, false);
          if (!quote) btn.textContent = 'Dapatkan harga';
          $('#err').textContent = friendlyError(e);
        }
      };
    },
  );
};

function showQuote(from, to, q) {
  const impact = Number(q.priceImpactPct || 0) * 100;
  const route = (q.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean);
  const el = $('#quote');
  el.innerHTML = `
    <div class="kv"><span>Anda menerima</span><b>${S.formatUnits(q.outAmount, to.decimals, 6)} ${esc(tokenLabel(to))}</b></div>
    <div class="kv"><span>Minimum diterima</span><b>${S.formatUnits(q.otherAmountThreshold, to.decimals, 6)}</b></div>
    <div class="kv"><span>Dampak harga</span><b class="${impact > 3 ? 'bad' : ''}">${impact < 0.01 ? '< 0.01' : impact.toFixed(2)}%</b></div>
    <div class="kv"><span>Rute</span><b>${esc([...new Set(route)].join(' → ') || 'Jupiter')}</b></div>`;
  el.classList.remove('hidden');
  if (impact > 3) $('#err').textContent = `Dampak harga tinggi (${impact.toFixed(1)}%). Pertimbangkan jumlah lebih kecil.`;
}
