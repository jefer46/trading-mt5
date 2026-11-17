import * as W from '../wallet.js';
import { local, session } from '../storage.js';
import { V, state, $, $$, esc, render, busy, toast, saveSettings, persistSecret, touch, syncPublicAccounts, simpleHeader } from '../ui.js';

V.welcome = function viewWelcome() {
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
        V.showMnemonic();
      };
      $('#import').onclick = V.import;
    },
  );
};

V.showMnemonic = function viewShowMnemonic() {
  const words = state.draft.mnemonic.split(' ');
  render(
    `${simpleHeader('Seed phrase')}
    <div class="pad">
      <p class="warn">Tulis 12 kata ini di kertas, urut. Siapa pun yang tahu kata-kata ini bisa mengambil semua dana Anda. Jangan pernah membagikannya.</p>
      <ol class="words">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <label class="check"><input type="checkbox" id="ok"> Saya sudah menyimpan seed phrase dengan aman</label>
      <button class="btn primary" id="next" disabled>Lanjut</button>
    </div>`,
    () => {
      $('#back').onclick = V.welcome;
      $('#ok').onchange = (e) => ($('#next').disabled = !e.target.checked);
      $('#next').onclick = V.verifyMnemonic;
    },
  );
};

V.verifyMnemonic = function viewVerifyMnemonic() {
  const words = state.draft.mnemonic.split(' ');
  const picks = [];
  while (picks.length < 3) {
    const i = Math.floor(Math.random() * words.length);
    if (!picks.includes(i)) picks.push(i);
  }
  picks.sort((a, b) => a - b);
  render(
    `${simpleHeader('Konfirmasi')}
    <div class="pad">
      <p class="muted">Masukkan kata-kata berikut untuk memastikan Anda sudah mencatatnya.</p>
      ${picks.map((i) => `<label>Kata ke-${i + 1}<input class="input" data-i="${i}" autocomplete="off" spellcheck="false"></label>`).join('')}
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Verifikasi</button>
    </div>`,
    () => {
      $('#back').onclick = V.showMnemonic;
      $('#next').onclick = () => {
        const ok = $$('[data-i]').every((inp) => inp.value.trim().toLowerCase() === words[Number(inp.dataset.i)]);
        if (!ok) return ($('#err').textContent = 'Ada kata yang salah. Periksa catatan Anda.');
        state.draft.secret = { type: 'mnemonic', mnemonic: state.draft.mnemonic, accounts: [{ index: 0, name: 'Akun 1' }] };
        V.setPassword(V.showMnemonic);
      };
    },
  );
};

V.import = function viewImport() {
  let mode = 'mnemonic';
  render(
    `${simpleHeader('Impor dompet')}
    <div class="pad">
      <div class="seg"><button class="on" data-m="mnemonic">Seed phrase</button><button data-m="key">Private key</button></div>
      <textarea class="input" id="val" rows="4" spellcheck="false" placeholder="12 atau 24 kata, dipisah spasi"></textarea>
      <p class="error" id="err"></p>
      <button class="btn primary" id="next">Impor</button>
    </div>`,
    () => {
      $('#back').onclick = V.welcome;
      $$('.seg button').forEach((b) => {
        b.onclick = () => {
          mode = b.dataset.m;
          $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
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
          V.setPassword(V.import);
        } catch (e) {
          $('#err').textContent = /base58|byte|Unexpected/i.test(e.message) ? 'Private key tidak valid.' : e.message;
        }
      };
    },
  );
};

V.setPassword = function viewSetPassword(back) {
  render(
    `${simpleHeader('Buat password')}
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
        await local.remove('connectedSites');
        await saveSettings();
        await persistSecret(p1);
        V.home();
      };
    },
  );
};

V.unlock = function viewUnlock() {
  render(
    `<div class="center hero">
      <div class="logo">◎</div>
      <h1>Selamat datang kembali</h1>
      ${state.afterUnlock ? '<p class="muted">Buka dompet untuk melanjutkan permintaan dari situs.</p>' : ''}
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
          await syncPublicAccounts();
          const next = state.afterUnlock || V.home;
          state.afterUnlock = null;
          next();
        } catch (err) {
          busy($('#go'), false);
          $('#err').textContent = err.message;
        }
      };
      $('#forgot').onclick = V.reset;
    },
  );
};

V.reset = function viewReset() {
  render(
    `${simpleHeader('Reset dompet')}
    <div class="pad">
      <p class="warn">Ini menghapus dompet dari browser ini. Dana hanya bisa dipulihkan dengan seed phrase / private key Anda. Tanpa itu, dana hilang permanen.</p>
      <label>Ketik <b>HAPUS</b> untuk konfirmasi<input class="input" id="c"></label>
      <button class="btn danger" id="go">Hapus dompet</button>
    </div>`,
    () => {
      $('#back').onclick = () => (state.secret ? V.settings() : V.unlock());
      $('#go').onclick = async () => {
        if ($('#c').value.trim() !== 'HAPUS') return toast('Ketik HAPUS untuk konfirmasi', 'err');
        for (const k of ['vault', 'publicAccounts', 'connectedSites']) await local.remove(k);
        await session.remove('unlocked');
        state.secret = null;
        state.portfolio = null;
        V.welcome();
      };
    },
  );
};
