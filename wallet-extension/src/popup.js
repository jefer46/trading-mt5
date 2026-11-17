import QRCode from 'qrcode';
import * as W from './wallet.js';
import * as S from './solana.js';
import { local, session } from './storage.js';

const AUTO_LOCK_MS = 15 * 60 * 1000;
const app = document.getElementById('app');

// ---------- State ----------

const state = {
  settings: { network: 'devnet', customRpc: '', activeAccount: 0 },
  secret: null, // isi vault yang sudah dibuka (hanya di memori + storage.session)
  draft: {}, // data sementara saat onboarding / kirim
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const $ = (sel) => app.querySelector(sel);

function render(html, bind) {
  app.innerHTML = html;
  bind?.();
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function copy(text, label = 'Disalin') {
  await navigator.clipboard.writeText(text);
  toast(label);
}

function busy(btn, on, text) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = text || 'Memproses…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label;
    btn.disabled = false;
  }
}

const conn = () => S.makeConnection(state.settings);
const accounts = () => state.secret.accounts;
const activeAcc = () => accounts().find((a) => a.index === state.settings.activeAccount) || accounts()[0];
const keypair = (index = activeAcc().index) => W.keypairForAccount(state.secret, index);
const net = () => S.NETWORKS[state.settings.network];

async function saveSettings() {
  await local.set('settings', state.settings);
}

/** Simpan ulang vault terenkripsi (dipakai saat menambah/mengganti nama akun). */
async function persistSecret(password) {
  await local.set('vault', await W.encryptVault(state.secret, password));
  await session.set('unlocked', { secret: state.secret, lastActive: Date.now() });
}

async function touch() {
  if (state.secret) await session.set('unlocked', { secret: state.secret, lastActive: Date.now() });
}

async function lock() {
  state.secret = null;
  await session.remove('unlocked');
  viewUnlock();
}

// ---------- Onboarding ----------

function viewWelcome() {
  render(
    `<div class="center hero">
      <div class="logo">◎</div>
      <h1>Dompet Solana</h1>
      <p class="muted">Dompet non-custodial: kunci Anda tersimpan terenkripsi di browser ini saja.</p>
      <button class="btn primary" id="create">Buat dompet baru</button>
      <button class="btn" id="import">Saya sudah punya dompet</button>
    </div>`,
    () => {
      $('#create').onclick = () => {
        state.draft = { mnemonic: W.createMnemonic() };
        viewShowMnemonic();
      };
      $('#import').onclick = viewImport;
    },
  );
}

function viewShowMnemonic() {
  const words = state.draft.mnemonic.split(' ');
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Seed phrase</h2><span></span></header>
    <div class="pad">
      <p class="warn">Tulis 12 kata ini di kertas, urut. Siapa pun yang tahu kata-kata ini bisa mengambil semua dana Anda. Jangan pernah membagikannya.</p>
      <ol class="words">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <label class="check"><input type="checkbox" id="ok"> Saya sudah menyimpan seed phrase dengan aman</label>
      <button class="btn primary" id="next" disabled>Lanjut</button>
    </div>`,
    () => {
      $('#back').onclick = viewWelcome;
      $('#ok').onchange = (e) => ($('#next').disabled = !e.target.checked);
      $('#next').onclick = viewVerifyMnemonic;
    },
  );
}

function viewVerifyMnemonic() {
  const words = state.draft.mnemonic.split(' ');
  const picks = [];
  while (picks.length < 3) {
    const i = Math.floor(Math.random() * words.length);
    if (!picks.includes(i)) picks.push(i);
  }
  picks.sort((a, b) => a - b);
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Konfirmasi</h2><span></span></header>
    <div class="pad">
      <p class="muted">Masukkan kata-kata berikut untuk memastikan Anda sudah mencatatnya.</p>
      ${picks
        .map(
          (i) =>
            `<label>Kata ke-${i + 1}<input class="input" data-i="${i}" autocomplete="off" spellcheck="false"></label>`,
        )
        .join('')}
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Verifikasi</button>
    </div>`,
    () => {
      $('#back').onclick = viewShowMnemonic;
      $('#next').onclick = () => {
        const ok = [...app.querySelectorAll('[data-i]')].every(
          (inp) => inp.value.trim().toLowerCase() === words[Number(inp.dataset.i)],
        );
        if (!ok) return ($('#err').textContent = 'Ada kata yang salah. Periksa catatan Anda.');
        state.draft.secret = { type: 'mnemonic', mnemonic: state.draft.mnemonic, accounts: [{ index: 0, name: 'Akun 1' }] };
        viewSetPassword(viewShowMnemonic);
      };
    },
  );
}

function viewImport() {
  let mode = 'mnemonic';
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Impor dompet</h2><span></span></header>
    <div class="pad">
      <div class="seg"><button class="on" data-m="mnemonic">Seed phrase</button><button data-m="key">Private key</button></div>
      <textarea class="input" id="val" rows="4" spellcheck="false" placeholder="12 atau 24 kata, dipisah spasi"></textarea>
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Impor</button>
    </div>`,
    () => {
      $('#back').onclick = viewWelcome;
      app.querySelectorAll('.seg button').forEach((b) => {
        b.onclick = () => {
          mode = b.dataset.m;
          app.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
          $('#val').placeholder = mode === 'mnemonic' ? '12 atau 24 kata, dipisah spasi' : 'Private key base58 (mis. ekspor dari Phantom)';
        };
      });
      $('#next').onclick = () => {
        const v = $('#val').value;
        try {
          if (mode === 'mnemonic') {
            if (!W.isValidMnemonic(v)) throw new Error('Seed phrase tidak valid.');
            state.draft.secret = { type: 'mnemonic', mnemonic: W.normalizeMnemonic(v), accounts: [{ index: 0, name: 'Akun 1' }] };
          } else {
            const kp = W.keypairFromPrivateKey(v);
            state.draft.secret = { type: 'privateKey', secretKey: W.exportPrivateKey(kp), accounts: [{ index: 0, name: 'Akun 1' }] };
          }
          viewSetPassword(viewImport);
        } catch (e) {
          $('#err').textContent = e.message.includes('Non-base58') ? 'Private key tidak valid.' : e.message;
        }
      };
    },
  );
}

function viewSetPassword(back) {
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Buat password</h2><span></span></header>
    <div class="pad">
      <p class="muted">Password ini mengenkripsi dompet di perangkat ini. Bukan pengganti seed phrase.</p>
      <label>Password<input class="input" type="password" id="p1" autocomplete="new-password"></label>
      <label>Ulangi password<input class="input" type="password" id="p2" autocomplete="new-password"></label>
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Simpan</button>
    </div>`,
    () => {
      $('#back').onclick = back;
      $('#next').onclick = async () => {
        const p1 = $('#p1').value;
        if (p1.length < 8) return ($('#err').textContent = 'Minimal 8 karakter.');
        if (p1 !== $('#p2').value) return ($('#err').textContent = 'Password tidak sama.');
        busy($('#next'), true, 'Mengenkripsi…');
        state.secret = state.draft.secret;
        state.draft = {};
        state.settings.activeAccount = 0;
        await saveSettings();
        await persistSecret(p1);
        viewHome();
      };
    },
  );
}

function viewUnlock() {
  render(
    `<div class="center hero">
      <div class="logo">◎</div>
      <h1>Selamat datang kembali</h1>
      <form id="f" class="stack">
        <input class="input" type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password">
        <p class="error" id="err"></p>
        <button class="btn primary" id="go">Buka</button>
      </form>
      <button class="link" id="forgot">Lupa password?</button>
    </div>`,
    () => {
      $('#f').onsubmit = async (e) => {
        e.preventDefault();
        busy($('#go'), true, 'Membuka…');
        try {
          state.secret = await W.decryptVault(await local.get('vault'), $('#pw').value);
          await touch();
          viewHome();
        } catch (err) {
          busy($('#go'), false);
          $('#err').textContent = err.message;
        }
      };
      $('#forgot').onclick = viewReset;
    },
  );
}

function viewReset() {
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Reset dompet</h2><span></span></header>
    <div class="pad">
      <p class="warn">Ini menghapus dompet dari browser ini. Dana hanya bisa dipulihkan dengan seed phrase / private key Anda. Tanpa itu, dana hilang permanen.</p>
      <label>Ketik <b>HAPUS</b> untuk konfirmasi<input class="input" id="c"></label>
      <button class="btn danger" id="go">Hapus dompet</button>
    </div>`,
    () => {
      $('#back').onclick = () => (state.secret ? viewSettings() : viewUnlock());
      $('#go').onclick = async () => {
        if ($('#c').value.trim() !== 'HAPUS') return toast('Ketik HAPUS untuk konfirmasi', 'err');
        await local.remove('vault');
        await session.remove('unlocked');
        state.secret = null;
        viewWelcome();
      };
    },
  );
}

// ---------- Home ----------

function header(title) {
  const acc = activeAcc();
  const addr = keypair().publicKey.toBase58();
  return `<header class="bar">
    <button class="acct" id="accts"><span class="avatar">${esc(acc.name.slice(0, 1))}</span><span><b>${esc(acc.name)}</b><small>${short(addr)}</small></span></button>
    ${title ? `<h2>${esc(title)}</h2>` : `<span class="net ${net().test ? 'test' : 'main'}">${net().label}</span>`}
    <button class="icon" id="settings" title="Pengaturan">⚙</button>
  </header>`;
}

function bindHeader() {
  $('#accts').onclick = viewAccounts;
  $('#settings').onclick = viewSettings;
}

async function viewHome() {
  touch();
  const addr = keypair().publicKey.toBase58();
  render(
    `${header()}
    <div class="pad">
      <button class="addr" id="copy" title="Salin alamat">${short(addr)} ⧉</button>
      <div class="balance"><span id="bal">…</span> <small>SOL</small></div>
      <div class="actions">
        <button class="act" id="recv"><span>↓</span>Terima</button>
        <button class="act" id="send"><span>↑</span>Kirim</button>
        ${net().test ? '<button class="act" id="drop"><span>☂</span>Airdrop</button>' : ''}
        <button class="act" id="refresh"><span>⟳</span>Muat ulang</button>
      </div>
      <div class="seg tabs"><button class="on" data-t="tokens">Token</button><button data-t="activity">Aktivitas</button></div>
      <div id="list" class="list"><p class="muted center">Memuat…</p></div>
    </div>`,
    () => {
      bindHeader();
      $('#copy').onclick = () => copy(addr, 'Alamat disalin');
      $('#recv').onclick = viewReceive;
      $('#send').onclick = () => viewSend();
      $('#refresh').onclick = viewHome;
      if ($('#drop')) $('#drop').onclick = () => doAirdrop(addr);
      app.querySelectorAll('.tabs button').forEach((b) => {
        b.onclick = () => {
          app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
          (b.dataset.t === 'tokens' ? loadTokens : loadActivity)(addr);
        };
      });
    },
  );
  const c = conn();
  S.getBalance(c, addr)
    .then((l) => {
      state.balance = l;
      if ($('#bal')) $('#bal').textContent = S.formatSol(l);
    })
    .catch(() => {
      if ($('#bal')) $('#bal').textContent = '—';
      toast('Gagal terhubung ke RPC', 'err');
    });
  loadTokens(addr);
}

async function loadTokens(addr) {
  const list = $('#list');
  list.innerHTML = '<p class="muted center">Memuat…</p>';
  try {
    const tokens = await S.getTokens(conn(), addr);
    if (!$('#list')) return;
    list.innerHTML = tokens.length
      ? tokens
          .map(
            (t) => `<a class="row" target="_blank" rel="noopener" href="${S.explorerUrl('address', t.mint, state.settings.network)}">
              <span class="avatar sm">◇</span><span class="grow"><b>${short(esc(t.mint))}</b><small>Token SPL</small></span><b>${esc(t.amount)}</b></a>`,
          )
          .join('')
      : '<p class="muted center">Belum ada token SPL.</p>';
  } catch {
    list.innerHTML = '<p class="muted center">Gagal memuat token.</p>';
  }
}

async function loadActivity(addr) {
  const list = $('#list');
  list.innerHTML = '<p class="muted center">Memuat…</p>';
  try {
    const sigs = await S.getActivity(conn(), addr);
    if (!$('#list')) return;
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
    list.innerHTML = '<p class="muted center">Gagal memuat aktivitas.</p>';
  }
}

async function doAirdrop(addr) {
  const btn = $('#drop');
  busy(btn, true, '…');
  try {
    await S.requestAirdrop(conn(), addr, 1);
    toast('Airdrop 1 SOL berhasil');
    viewHome();
  } catch (e) {
    busy(btn, false);
    toast(/429|limit/i.test(e.message) ? 'Batas airdrop tercapai. Coba faucet.solana.com' : 'Airdrop gagal', 'err');
  }
}

// ---------- Terima ----------

async function viewReceive() {
  const addr = keypair().publicKey.toBase58();
  const qr = await QRCode.toDataURL(addr, { margin: 1, width: 220, color: { dark: '#111', light: '#fff' } });
  render(
    `${header('Terima')}
    <div class="pad center">
      <img class="qr" src="${qr}" alt="QR alamat">
      <p class="mono">${addr}</p>
      <p class="muted">Hanya kirim SOL dan token jaringan Solana (${net().label}) ke alamat ini.</p>
      <button class="btn primary" id="copy">Salin alamat</button>
      <button class="btn" id="back">Kembali</button>
    </div>`,
    () => {
      bindHeader();
      $('#copy').onclick = () => copy(addr, 'Alamat disalin');
      $('#back').onclick = viewHome;
    },
  );
}

// ---------- Kirim ----------

function viewSend(prefill = {}) {
  const bal = state.balance ?? 0;
  render(
    `${header('Kirim SOL')}
    <div class="pad">
      <label>Alamat penerima<input class="input mono" id="to" spellcheck="false" value="${esc(prefill.to || '')}"></label>
      <label>Jumlah (SOL)
        <div class="inline"><input class="input" id="amt" inputmode="decimal" placeholder="0.0" value="${esc(prefill.amount || '')}"><button class="btn sm" id="max">Max</button></div>
      </label>
      <p class="muted">Saldo: ${S.formatSol(bal)} SOL · Biaya jaringan ≈ ${S.formatSol(S.FEE_LAMPORTS)} SOL</p>
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Lanjut</button>
      <button class="btn" id="back">Batal</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = viewHome;
      $('#max').onclick = () => ($('#amt').value = S.formatSol(Math.max(0, bal - S.FEE_LAMPORTS)).replace(/,/g, ''));
      $('#next').onclick = () => {
        const to = $('#to').value.trim();
        const amount = $('#amt').value.trim();
        try {
          if (!S.isValidAddress(to)) throw new Error('Alamat penerima tidak valid.');
          const lamports = S.solToLamports(amount);
          if (lamports <= 0) throw new Error('Jumlah harus lebih dari 0.');
          if (lamports + S.FEE_LAMPORTS > bal) throw new Error('Saldo tidak cukup (termasuk biaya).');
          viewConfirmSend({ to, amount, lamports });
        } catch (e) {
          $('#err').textContent = e.message;
        }
      };
    },
  );
}

function viewConfirmSend(tx) {
  const from = keypair().publicKey.toBase58();
  render(
    `${header('Konfirmasi')}
    <div class="pad">
      <div class="card">
        <div class="kv"><span>Dari</span><b class="mono">${short(from)}</b></div>
        <div class="kv"><span>Ke</span><b class="mono">${short(tx.to)}</b></div>
        <div class="kv"><span>Jumlah</span><b>${esc(tx.amount)} SOL</b></div>
        <div class="kv"><span>Biaya</span><b>${S.formatSol(S.FEE_LAMPORTS)} SOL</b></div>
        <div class="kv"><span>Jaringan</span><b>${net().label}</b></div>
      </div>
      ${net().test ? '' : '<p class="warn">Ini MAINNET — dana sungguhan. Transaksi tidak bisa dibatalkan.</p>'}
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Kirim</button>
      <button class="btn" id="back">Ubah</button>
    </div>`,
    () => {
      bindHeader();
      $('#back').onclick = () => viewSend(tx);
      $('#go').onclick = async () => {
        busy($('#go'), true, 'Mengirim…');
        $('#back').disabled = true;
        try {
          const sig = await S.sendSol(conn(), keypair(), tx.to, tx.lamports);
          viewSent(sig, tx);
        } catch (e) {
          busy($('#go'), false);
          $('#back').disabled = false;
          $('#err').textContent = e.message;
        }
      };
    },
  );
}

function viewSent(sig, tx) {
  render(
    `${header('Terkirim')}
    <div class="pad center">
      <div class="logo ok">✓</div>
      <h2>${esc(tx.amount)} SOL terkirim</h2>
      <p class="muted">ke ${short(tx.to)}</p>
      <a class="btn" target="_blank" rel="noopener" href="${S.explorerUrl('tx', sig, state.settings.network)}">Lihat di Explorer ↗</a>
      <button class="btn primary" id="done">Selesai</button>
    </div>`,
    () => {
      bindHeader();
      $('#done').onclick = viewHome;
    },
  );
}

// ---------- Akun ----------

function viewAccounts() {
  const canAdd = state.secret.type === 'mnemonic';
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Akun</h2><span></span></header>
    <div class="pad">
      <div class="list">
        ${accounts()
          .map((a) => {
            const addr = keypair(a.index).publicKey.toBase58();
            return `<div class="row ${a.index === activeAcc().index ? 'sel' : ''}" data-i="${a.index}">
              <span class="avatar">${esc(a.name.slice(0, 1))}</span>
              <span class="grow"><b>${esc(a.name)}</b><small>${short(addr)}</small></span>
              <button class="icon" data-rename="${a.index}" title="Ganti nama">✎</button></div>`;
          })
          .join('')}
      </div>
      ${canAdd ? '<button class="btn primary" id="add">+ Tambah akun</button>' : '<p class="muted">Dompet dari private key hanya punya satu akun.</p>'}
    </div>`,
    () => {
      $('#back').onclick = viewHome;
      app.querySelectorAll('.row[data-i]').forEach((r) => {
        r.onclick = async (e) => {
          if (e.target.closest('[data-rename]')) return;
          state.settings.activeAccount = Number(r.dataset.i);
          await saveSettings();
          viewHome();
        };
      });
      app.querySelectorAll('[data-rename]').forEach((b) => {
        b.onclick = () => viewRename(Number(b.dataset.rename));
      });
      if ($('#add')) {
        $('#add').onclick = () => viewPasswordPrompt('Tambah akun', async (pw) => {
          const index = Math.max(...accounts().map((a) => a.index)) + 1;
          accounts().push({ index, name: `Akun ${index + 1}` });
          await persistSecret(pw);
          state.settings.activeAccount = index;
          await saveSettings();
          toast(`Akun ${index + 1} ditambahkan`);
          viewHome();
        }, viewAccounts);
      }
    },
  );
}

function viewRename(index) {
  const acc = accounts().find((a) => a.index === index);
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Ganti nama</h2><span></span></header>
    <form class="pad" id="f">
      <label>Nama akun<input class="input" id="name" maxlength="24" value="${esc(acc.name)}"></label>
      <label>Password<input class="input" type="password" id="pw"></label>
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Simpan</button>
    </form>`,
    () => {
      $('#back').onclick = viewAccounts;
      $('#f').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#name').value.trim();
        if (!name) return ($('#err').textContent = 'Nama tidak boleh kosong.');
        busy($('#go'), true, 'Menyimpan…');
        const pw = $('#pw').value;
        try {
          await W.decryptVault(await local.get('vault'), pw);
        } catch (err) {
          busy($('#go'), false);
          return ($('#err').textContent = err.message);
        }
        acc.name = name;
        await persistSecret(pw);
        viewAccounts();
      };
    },
  );
}

/** Minta password ulang sebelum aksi sensitif. */
function viewPasswordPrompt(title, onOk, back) {
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>${esc(title)}</h2><span></span></header>
    <form class="pad" id="f">
      <label>Masukkan password<input class="input" type="password" id="pw" autofocus></label>
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Lanjut</button>
    </form>`,
    () => {
      $('#back').onclick = back;
      $('#f').onsubmit = async (e) => {
        e.preventDefault();
        busy($('#go'), true, 'Memeriksa…');
        const pw = $('#pw').value;
        try {
          await W.decryptVault(await local.get('vault'), pw);
        } catch (err) {
          busy($('#go'), false);
          return ($('#err').textContent = err.message);
        }
        await onOk(pw);
      };
    },
  );
}

// ---------- Pengaturan ----------

function viewSettings() {
  const s = state.settings;
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>Pengaturan</h2><span></span></header>
    <div class="pad">
      <label>Jaringan
        <select class="input" id="net">
          ${Object.entries(S.NETWORKS)
            .map(([k, v]) => `<option value="${k}" ${k === s.network ? 'selected' : ''}>${v.label}${v.test ? '' : ' (dana sungguhan)'}</option>`)
            .join('')}
        </select>
      </label>
      <label class="check hidden" id="mainnetOk"><input type="checkbox" id="mok"> Saya paham Mainnet memakai dana sungguhan dan dompet ini belum diaudit</label>
      <label>RPC kustom (opsional)<input class="input mono" id="rpc" placeholder="https://…" value="${esc(s.customRpc || '')}"></label>
      <button class="btn" id="save">Simpan jaringan</button>
      <hr>
      ${state.secret.type === 'mnemonic' ? '<button class="btn" id="seed">Tampilkan seed phrase</button>' : ''}
      <button class="btn" id="pk">Ekspor private key (akun aktif)</button>
      <button class="btn" id="lock">Kunci dompet</button>
      <button class="btn danger" id="reset">Hapus dompet dari browser ini</button>
    </div>`,
    () => {
      $('#back').onclick = viewHome;
      const needsAck = () => !S.NETWORKS[$('#net').value].test && s.network !== $('#net').value;
      $('#net').onchange = () => $('#mainnetOk').classList.toggle('hidden', !needsAck());
      $('#save').onclick = async () => {
        const network = $('#net').value;
        const rpc = $('#rpc').value.trim();
        if (rpc && !/^https:\/\//.test(rpc)) return toast('RPC harus diawali https://', 'err');
        if (needsAck() && !$('#mok').checked) return toast('Centang konfirmasi Mainnet dulu', 'err');
        Object.assign(state.settings, { network, customRpc: rpc });
        await saveSettings();
        toast(`Jaringan: ${S.NETWORKS[network].label}`);
        viewHome();
      };
      if ($('#seed')) $('#seed').onclick = () => viewPasswordPrompt('Seed phrase', () => viewSecret('Seed phrase', state.secret.mnemonic), viewSettings);
      $('#pk').onclick = () => viewPasswordPrompt('Private key', () => viewSecret('Private key', W.exportPrivateKey(keypair())), viewSettings);
      $('#lock').onclick = lock;
      $('#reset').onclick = viewReset;
    },
  );
}

function viewSecret(title, value) {
  render(
    `<header class="bar"><button class="icon" id="back">←</button><h2>${esc(title)}</h2><span></span></header>
    <div class="pad">
      <p class="warn">Jangan bagikan ke siapa pun, termasuk "admin" atau "support". Siapa pun yang memilikinya menguasai dana Anda.</p>
      <div class="secret blur" id="sec" title="Klik untuk menampilkan">${esc(value)}</div>
      <button class="btn" id="copy">Salin</button>
      <button class="btn primary" id="back2">Selesai</button>
    </div>`,
    () => {
      $('#sec').onclick = (e) => e.currentTarget.classList.remove('blur');
      $('#copy').onclick = () => copy(value);
      $('#back').onclick = $('#back2').onclick = viewSettings;
    },
  );
}

// ---------- Mulai ----------

async function init() {
  const saved = await local.get('settings');
  if (saved) Object.assign(state.settings, saved);
  const vault = await local.get('vault');
  if (!vault) return viewWelcome();
  const unlocked = await session.get('unlocked');
  if (unlocked && Date.now() - unlocked.lastActive < AUTO_LOCK_MS) {
    state.secret = unlocked.secret;
    return viewHome();
  }
  await session.remove('unlocked');
  viewUnlock();
}

init();
