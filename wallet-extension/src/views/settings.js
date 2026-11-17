import * as W from '../wallet.js';
import * as S from '../solana.js';
import * as M from '../market.js';
import { local } from '../storage.js';
import {
  V, state, $, $$, esc, short, render, toast, copy, busy, accounts, activeAcc, keypair,
  saveSettings, persistSecret, lock, checkPassword, simpleHeader,
} from '../ui.js';

// ---------- Akun ----------

V.accounts = function viewAccounts() {
  const canAdd = state.secret.type === 'mnemonic';
  render(
    `${simpleHeader('Akun')}
    <div class="pad">
      <div class="list">
        ${accounts()
          .map((a) => {
            const addr = keypair(a.index).publicKey.toBase58();
            return `<div class="row ${a.index === activeAcc().index ? 'sel' : ''}" data-i="${a.index}">
              <span class="avatar">${esc(a.name.slice(0, 1))}</span>
              <span class="grow"><b>${esc(a.name)}</b><small>${short(addr)}</small></span>
              <button class="icon" data-copy="${addr}" title="Salin alamat">⧉</button>
              <button class="icon" data-rename="${a.index}" title="Ganti nama">✎</button></div>`;
          })
          .join('')}
      </div>
      ${canAdd ? '<button class="btn primary" id="add">+ Tambah akun</button>' : '<p class="muted">Dompet dari private key hanya punya satu akun.</p>'}
    </div>`,
    () => {
      $('#back').onclick = V.home;
      $$('.row[data-i]').forEach((r) => {
        r.onclick = async (e) => {
          if (e.target.closest('button')) return;
          state.settings.activeAccount = Number(r.dataset.i);
          state.portfolio = null;
          await saveSettings();
          V.home();
        };
      });
      $$('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, 'Alamat disalin')));
      $$('[data-rename]').forEach((b) => (b.onclick = () => V.rename(Number(b.dataset.rename))));
      if ($('#add')) {
        $('#add').onclick = () =>
          V.passwordPrompt(
            'Tambah akun',
            async (pw) => {
              const index = Math.max(...accounts().map((a) => a.index)) + 1;
              accounts().push({ index, name: `Akun ${index + 1}` });
              await persistSecret(pw);
              state.settings.activeAccount = index;
              state.portfolio = null;
              await saveSettings();
              toast(`Akun ${index + 1} ditambahkan`);
              V.home();
            },
            V.accounts,
          );
      }
    },
  );
};

V.rename = function viewRename(index) {
  const acc = accounts().find((a) => a.index === index);
  render(
    `${simpleHeader('Ganti nama')}
    <form class="pad" id="f">
      <label>Nama akun<input class="input" id="name" maxlength="24" value="${esc(acc.name)}"></label>
      <label>Password<input class="input" type="password" id="pw"></label>
      <p class="error" id="err"></p>
      <button class="btn primary" id="go">Simpan</button>
    </form>`,
    () => {
      $('#back').onclick = V.accounts;
      $('#f').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#name').value.trim();
        if (!name) return ($('#err').textContent = 'Nama tidak boleh kosong.');
        busy($('#go'), true, 'Menyimpan…');
        const pw = $('#pw').value;
        try {
          await checkPassword(pw);
        } catch (err) {
          busy($('#go'), false);
          return ($('#err').textContent = err.message);
        }
        acc.name = name;
        await persistSecret(pw);
        V.accounts();
      };
    },
  );
};

/** Minta password ulang sebelum aksi sensitif. */
V.passwordPrompt = function viewPasswordPrompt(title, onOk, back) {
  render(
    `${simpleHeader(title)}
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
          await checkPassword(pw);
        } catch (err) {
          busy($('#go'), false);
          return ($('#err').textContent = err.message);
        }
        await onOk(pw);
      };
    },
  );
};

// ---------- Pengaturan ----------

V.settings = function viewSettings() {
  const s = state.settings;
  render(
    `${simpleHeader('Pengaturan')}
    <div class="pad">
      <h3>Jaringan</h3>
      <select class="input" id="net">
        ${Object.entries(S.NETWORKS)
          .map(([k, v]) => `<option value="${k}" ${k === s.network ? 'selected' : ''}>${v.label}${v.test ? '' : ' (dana sungguhan)'}</option>`)
          .join('')}
      </select>
      <label class="check hidden" id="mainnetOk"><input type="checkbox" id="mok"> Saya paham Mainnet memakai dana sungguhan dan dompet ini belum diaudit</label>
      <label>RPC kustom (opsional)<input class="input mono" id="rpc" placeholder="https://…" value="${esc(s.customRpc || '')}"></label>
      <label>Mata uang
        <select class="input" id="cur">${Object.entries(M.CURRENCIES).map(([k, v]) => `<option value="${k}" ${k === s.currency ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </label>
      <button class="btn" id="save">Simpan</button>
      <hr>
      <h3>Keamanan & privasi</h3>
      <button class="btn" id="sites">Situs yang terhubung</button>
      ${state.secret.type === 'mnemonic' ? '<button class="btn" id="seed">Tampilkan seed phrase</button>' : ''}
      <button class="btn" id="pk">Ekspor private key (akun aktif)</button>
      <button class="btn" id="lock">Kunci dompet</button>
      <button class="btn danger" id="reset">Hapus dompet dari browser ini</button>
    </div>`,
    () => {
      $('#back').onclick = V.home;
      const needsAck = () => !S.NETWORKS[$('#net').value].test && s.network !== $('#net').value;
      $('#net').onchange = () => $('#mainnetOk').classList.toggle('hidden', !needsAck());
      $('#save').onclick = async () => {
        const network = $('#net').value;
        const rpc = $('#rpc').value.trim();
        if (rpc && !/^https:\/\//.test(rpc)) return toast('RPC harus diawali https://', 'err');
        if (needsAck() && !$('#mok').checked) return toast('Centang konfirmasi Mainnet dulu', 'err');
        Object.assign(state.settings, { network, customRpc: rpc, currency: $('#cur').value });
        state.portfolio = null;
        await saveSettings();
        toast(`Tersimpan · ${S.NETWORKS[network].label}`);
        V.home();
      };
      $('#sites').onclick = V.sites;
      if ($('#seed')) $('#seed').onclick = () => V.passwordPrompt('Seed phrase', () => V.secret('Seed phrase', state.secret.mnemonic), V.settings);
      $('#pk').onclick = () => V.passwordPrompt('Private key', () => V.secret('Private key', W.exportPrivateKey(keypair())), V.settings);
      $('#lock').onclick = lock;
      $('#reset').onclick = V.reset;
    },
  );
};

V.sites = async function viewSites() {
  const sites = (await local.get('connectedSites')) || {};
  const origins = Object.keys(sites).sort();
  render(
    `${simpleHeader('Situs terhubung')}
    <div class="pad">
      <p class="muted">Situs ini bisa melihat alamat akun aktif Anda dan meminta persetujuan transaksi. Mereka tidak bisa mengambil dana tanpa persetujuan Anda.</p>
      <div class="list">
        ${origins
          .map(
            (o) => `<div class="row"><span class="avatar sm">🌐</span><span class="grow"><b>${esc(o.replace(/^https?:\/\//, ''))}</b><small>Sejak ${new Date(sites[o].connectedAt).toLocaleDateString('id-ID')}</small></span>
            <button class="btn sm" data-o="${esc(o)}">Putuskan</button></div>`,
          )
          .join('') || '<p class="muted center">Belum ada situs yang terhubung.</p>'}
      </div>
      ${origins.length ? '<button class="btn danger" id="all">Putuskan semua</button>' : ''}
    </div>`,
    () => {
      $('#back').onclick = V.settings;
      $$('[data-o]').forEach((b) => {
        b.onclick = async () => {
          const cur = (await local.get('connectedSites')) || {};
          delete cur[b.dataset.o];
          await local.set('connectedSites', cur);
          V.sites();
        };
      });
      if ($('#all')) {
        $('#all').onclick = async () => {
          await local.set('connectedSites', {});
          V.sites();
        };
      }
    },
  );
};

V.secret = function viewSecret(title, value) {
  render(
    `${simpleHeader(title)}
    <div class="pad">
      <p class="warn">Jangan bagikan ke siapa pun, termasuk "admin" atau "support". Siapa pun yang memilikinya menguasai dana Anda.</p>
      <div class="secret blur" id="sec" title="Klik untuk menampilkan">${esc(value)}</div>
      <button class="btn" id="copy">Salin</button>
      <button class="btn primary" id="back2">Selesai</button>
    </div>`,
    () => {
      $('#sec').onclick = (e) => e.currentTarget.classList.remove('blur');
      $('#copy').onclick = () => copy(value);
      $('#back').onclick = $('#back2').onclick = V.settings;
    },
  );
};
