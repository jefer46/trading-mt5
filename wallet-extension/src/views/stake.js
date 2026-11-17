import * as S from '../solana.js';
import {
  V, state, $, $$, esc, short, render, busy, conn, net, keypair, address,
  header, bindHeader, friendlyError,
} from '../ui.js';

const STATUS = {
  active: ['Aktif', 'ok'],
  activating: ['Mengaktifkan', 'pending'],
  deactivating: ['Menonaktifkan', 'pending'],
  inactive: ['Tidak aktif', 'off'],
};

let validatorCache = { network: null, list: null };

async function validators() {
  if (validatorCache.network !== state.settings.network || !validatorCache.list) {
    validatorCache = { network: state.settings.network, list: await S.getValidators(conn()) };
  }
  return validatorCache.list;
}

V.stake = async function viewStake() {
  render(
    `${header('Staking')}
    <div class="pad">
      <p class="muted">Stake SOL ke validator untuk mendapat imbalan (±6–8% per tahun di Mainnet). SOL tetap milik Anda; untuk menarik, nonaktifkan dulu lalu tunggu akhir epoch (±2 hari).</p>
      <button class="btn primary" id="new">+ Stake SOL</button>
      <h3>Akun stake Anda</h3>
      <div class="list" id="list"><p class="muted center">Memuat…</p></div>
      <button class="btn" id="back">Kembali</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = V.home;
      $('#new').onclick = V.stakeNew;
    },
  );
  try {
    const [accs, vals] = await Promise.all([S.getStakeAccounts(conn(), address()), validators().catch(() => [])]);
    if (!$('#list')) return;
    const nameOf = (vote) => vals.find((v) => v.votePubkey === vote)?.name || short(vote);
    $('#list').innerHTML = accs.length
      ? accs
          .map((a, i) => {
            const [label, cls] = STATUS[a.status];
            return `<div class="row col" data-i="${i}">
              <div class="row-inline"><b>${S.formatSol(a.lamports)} SOL</b><span class="pill ${cls}">${label}</span></div>
              <small>Validator: ${esc(a.voter ? nameOf(a.voter) : '—')} · Akun ${short(a.address)}</small>
              <div class="row-inline">
                ${a.status === 'active' || a.status === 'activating' ? `<button class="btn sm" data-deact="${i}">Nonaktifkan</button>` : ''}
                ${a.status === 'inactive' ? `<button class="btn sm primary" data-wd="${i}">Tarik ke dompet</button>` : ''}
                <a class="btn sm" target="_blank" rel="noopener" href="${S.explorerUrl('address', a.address, state.settings.network)}">Explorer ↗</a>
              </div>
            </div>`;
          })
          .join('')
      : '<p class="muted center">Belum ada SOL yang di-stake.</p>';
    $$('[data-deact]').forEach((b) => {
      b.onclick = () => act(b, 'Menonaktifkan…', () => S.deactivateStake(conn(), keypair(), accs[Number(b.dataset.deact)].address), 'Stake dinonaktifkan', 'Bisa ditarik setelah epoch berakhir.');
    });
    $$('[data-wd]').forEach((b) => {
      const a = accs[Number(b.dataset.wd)];
      b.onclick = () => act(b, 'Menarik…', () => S.withdrawStake(conn(), keypair(), a.address, a.lamports), `${S.formatSol(a.lamports)} SOL ditarik`, '');
    });
  } catch (e) {
    if ($('#list')) $('#list').innerHTML = `<p class="muted center">${esc(friendlyError(e))}</p>`;
  }
};

async function act(btn, label, fn, title, subtitle) {
  busy(btn, true, label);
  try {
    const sig = await fn();
    state.portfolio = null;
    V.done({ title, subtitle, sig, next: V.stake });
  } catch (e) {
    busy(btn, false);
    alertError(e);
  }
}

function alertError(e) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = friendlyError(e);
  $('#list')?.prepend(p);
}

V.stakeNew = async function viewStakeNew() {
  render(
    `${header('Stake SOL')}
    <div class="pad">
      <label>Cari validator<input class="input" id="q" placeholder="Nama atau alamat"></label>
      <div class="list scroll" id="vals"><p class="muted center">Memuat validator…</p></div>
      <label>Jumlah (SOL)<input class="input" id="amt" inputmode="decimal" placeholder="0.0"></label>
      <p class="muted small" id="info"></p>
      <p class="error" id="err"></p>
      <button class="btn primary" id="go" disabled>Stake</button>
      <button class="btn" id="back">Batal</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = V.stake;
    },
  );
  let vals;
  let rent;
  let balance;
  try {
    [vals, rent, balance] = await Promise.all([validators(), S.stakeRentExempt(conn()), S.getBalance(conn(), address())]);
  } catch (e) {
    if ($('#vals')) $('#vals').innerHTML = `<p class="error">${esc(friendlyError(e))}</p>`;
    return;
  }
  if (!$('#vals')) return;
  let chosen = null;
  $('#info').textContent = `Saldo: ${S.formatSol(balance)} SOL · ±${S.formatSol(rent)} SOL dipakai sebagai cadangan akun stake (ikut kembali saat ditarik).`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const shown = vals.filter((v) => !q || v.name.toLowerCase().includes(q) || v.votePubkey.toLowerCase().includes(q)).slice(0, 25);
    $('#vals').innerHTML = shown
      .map(
        (v) => `<button class="row ${chosen === v.votePubkey ? 'sel' : ''}" data-v="${v.votePubkey}">
          <span class="avatar sm">${esc((v.name || 'V').slice(0, 1))}</span>
          <span class="grow"><b>${esc(v.name || short(v.votePubkey))}</b><small>${S.formatSol(v.activatedStake).split('.')[0]} SOL di-stake</small></span>
          <small>Komisi ${v.commission}%</small></button>`,
      )
      .join('') || '<p class="muted center">Tidak ditemukan.</p>';
    $$('[data-v]').forEach((b) => {
      b.onclick = () => {
        chosen = b.dataset.v;
        $('#go').disabled = false;
        draw();
      };
    });
  };
  $('#q').oninput = draw;
  draw();

  $('#go').onclick = async () => {
    $('#err').textContent = '';
    try {
      const lamports = S.solToLamports($('#amt').value.replace(/,/g, ''));
      if (lamports < rent) throw new Error(`Minimal ${S.formatSol(rent)} SOL.`);
      if (lamports + 2 * S.FEE_LAMPORTS > balance) throw new Error('Saldo tidak cukup (termasuk biaya).');
      if (!net().test && lamports > balance - 10_000_000) throw new Error('Sisakan minimal 0.01 SOL untuk biaya transaksi nanti.');
      busy($('#go'), true, 'Men-stake…');
      const { sig } = await S.stakeSol(conn(), keypair(), chosen, lamports);
      state.portfolio = null;
      const v = vals.find((x) => x.votePubkey === chosen);
      V.done({ title: `${S.formatSol(lamports)} SOL di-stake`, subtitle: `ke ${v.name || short(chosen)}. Aktif mulai epoch berikutnya.`, sig, next: V.stake });
    } catch (e) {
      busy($('#go'), false);
      $('#err').textContent = friendlyError(e);
    }
  };
};
