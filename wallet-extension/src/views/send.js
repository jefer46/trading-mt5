import * as S from '../solana.js';
import {
  V, state, $, esc, short, render, busy, conn, net, keypair, address,
  header, bindHeader, loadPortfolio, tokenLabel, friendlyError,
} from '../ui.js';

const SOL = { mint: 'SOL', decimals: 9, symbol: 'SOL', name: 'Solana' };

function assets() {
  const p = state.portfolio;
  return [{ ...SOL, amountRaw: String(p.lamports) }, ...p.tokens];
}

/** Kirim SOL / token / NFT. prefill: { mint, to, amount } */
V.send = async function viewSend(prefill = {}) {
  if (!state.portfolio || state.portfolio.address !== address()) {
    render(`${header('Kirim')}<div class="pad"><p class="muted center">Memuat saldo…</p></div>`, bindHeader);
    try {
      await loadPortfolio();
    } catch (e) {
      return render(`${header('Kirim')}<div class="pad"><p class="error">${esc(friendlyError(e))}</p><button class="btn" id="back">Kembali</button></div>`, () => {
        bindHeader();
        $('#back').onclick = V.home;
      });
    }
  }
  const list = assets();
  let asset = list.find((a) => a.mint === (prefill.mint || 'SOL')) || list[0];

  render(
    `${header('Kirim')}
    <div class="pad">
      <label>Aset
        <select class="input" id="asset">
          ${list
            .map(
              (a) =>
                `<option value="${esc(a.mint)}" ${a === asset ? 'selected' : ''}>${esc(a.isNft ? `NFT · ${a.name || short(a.mint)}` : tokenLabel(a))} — ${S.formatUnits(a.amountRaw, a.decimals, 6)}</option>`,
            )
            .join('')}
        </select>
      </label>
      <label>Alamat penerima<input class="input mono" id="to" spellcheck="false" placeholder="Alamat Solana" value="${esc(prefill.to || '')}"></label>
      <label id="amtWrap">Jumlah
        <div class="inline"><input class="input" id="amt" inputmode="decimal" placeholder="0.0" value="${esc(prefill.amount || '')}"><button class="btn sm" id="max">Max</button></div>
      </label>
      <p class="muted" id="info"></p>
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Lanjut</button>
      <button class="btn" id="back">Batal</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = V.home;
      const update = () => {
        asset = list.find((a) => a.mint === $('#asset').value);
        $('#amtWrap').classList.toggle('hidden', !!asset.isNft);
        $('#info').textContent =
          `Saldo: ${S.formatUnits(asset.amountRaw, asset.decimals)} ${asset.isNft ? 'NFT' : tokenLabel(asset)} · ` +
          `Biaya ≈ ${S.formatSol(S.FEE_LAMPORTS)} SOL` +
          (asset.mint !== 'SOL' ? ' (+ ±0.002 SOL bila penerima belum punya akun token ini)' : '');
      };
      $('#asset').onchange = update;
      update();
      $('#max').onclick = () => {
        const max = asset.mint === 'SOL' ? BigInt(Math.max(0, state.portfolio.lamports - S.FEE_LAMPORTS)) : BigInt(asset.amountRaw);
        $('#amt').value = S.formatUnits(max, asset.decimals).replace(/,/g, '');
      };
      $('#next').onclick = () => {
        const to = $('#to').value.trim();
        try {
          if (!S.isValidAddress(to)) throw new Error('Alamat penerima tidak valid.');
          if (to === address()) throw new Error('Tidak bisa mengirim ke alamat sendiri.');
          const amountRaw = asset.isNft ? 1n : S.parseUnits($('#amt').value.replace(/,/g, ''), asset.decimals);
          if (amountRaw <= 0n) throw new Error('Jumlah harus lebih dari 0.');
          if (amountRaw > BigInt(asset.amountRaw)) throw new Error('Saldo token tidak cukup.');
          const lamports = state.portfolio.lamports;
          const needSol = BigInt(S.FEE_LAMPORTS) + (asset.mint === 'SOL' ? amountRaw : 0n);
          if (needSol > BigInt(lamports)) throw new Error('Saldo SOL tidak cukup (termasuk biaya).');
          V.confirmSend({ asset, to, amountRaw });
        } catch (e) {
          $('#err').textContent = e.message;
        }
      };
    },
  );
};

V.confirmSend = function viewConfirmSend(tx) {
  const { asset, to, amountRaw } = tx;
  const label = asset.isNft ? asset.name || 'NFT' : `${S.formatUnits(amountRaw, asset.decimals)} ${tokenLabel(asset)}`;
  render(
    `${header('Konfirmasi')}
    <div class="pad">
      <div class="card">
        <div class="kv"><span>Dari</span><b class="mono">${short(address())}</b></div>
        <div class="kv"><span>Ke</span><b class="mono">${short(to)}</b></div>
        <div class="kv"><span>${asset.isNft ? 'NFT' : 'Jumlah'}</span><b>${esc(label)}</b></div>
        <div class="kv"><span>Biaya</span><b>≈ ${S.formatSol(S.FEE_LAMPORTS)} SOL</b></div>
        <div class="kv"><span>Jaringan</span><b>${net().label}</b></div>
      </div>
      ${net().test ? '' : '<p class="warn">Ini MAINNET — dana sungguhan. Transaksi tidak bisa dibatalkan.</p>'}
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Kirim</button>
      <button class="btn" id="back">Ubah</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = () =>
        V.send({ mint: asset.mint, to, amount: asset.isNft ? '' : S.formatUnits(amountRaw, asset.decimals).replace(/,/g, '') });
      $('#go').onclick = async () => {
        busy($('#go'), true, 'Mengirim…');
        $('#back').disabled = true;
        try {
          const sig =
            asset.mint === 'SOL'
              ? await S.sendSol(conn(), keypair(), to, Number(amountRaw))
              : await S.sendToken(conn(), keypair(), asset, to, amountRaw);
          state.portfolio = null;
          V.done({ title: `${label} terkirim`, subtitle: `ke ${short(to)}`, sig });
        } catch (e) {
          busy($('#go'), false);
          $('#back').disabled = false;
          $('#err').textContent = friendlyError(e);
        }
      };
    },
  );
};

/** Layar sukses umum (kirim, swap, stake). */
V.done = function viewDone({ title, subtitle = '', sig, next = V.home }) {
  render(
    `${header('Berhasil')}
    <div class="pad center">
      <div class="logo ok">✓</div>
      <h2>${esc(title)}</h2>
      ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
      ${sig ? `<a class="btn" target="_blank" rel="noopener" href="${S.explorerUrl('tx', sig, state.settings.network)}">Lihat di Explorer ↗</a>` : ''}
      <button class="btn primary" id="done">Selesai</button>
    </div>`,
    () => {
      bindHeader();
      $('#done').onclick = next;
    },
  );
};
