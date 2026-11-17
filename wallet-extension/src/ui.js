// State & helper bersama untuk semua tampilan popup.

import * as W from './wallet.js';
import * as S from './solana.js';
import * as M from './market.js';
import { local, session } from './storage.js';

export const AUTO_LOCK_MS = 15 * 60 * 1000;
export const app = document.getElementById('app');

export const state = {
  settings: { network: 'devnet', customRpc: '', activeAccount: 0, currency: 'usd' },
  secret: null, // isi vault yang sudah dibuka (hanya di memori + storage.session)
  draft: {}, // data sementara saat onboarding
  portfolio: null, // { address, lamports, tokens, prices }
  afterUnlock: null, // tampilan setelah dompet dibuka (mis. jendela persetujuan dApp)
};

/** Registry tampilan, diisi oleh modul views/*. Menghindari import melingkar. */
export const V = {};

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
export const $ = (sel) => app.querySelector(sel);
export const $$ = (sel) => [...app.querySelectorAll(sel)];

export function render(html, bind) {
  app.innerHTML = html;
  bind?.();
}

export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export async function copy(text, label = 'Disalin') {
  await navigator.clipboard.writeText(text);
  toast(label);
}

export function busy(btn, on, text) {
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

/** Pesan error RPC dibuat lebih ramah. */
export function friendlyError(e) {
  const m = String(e?.message || e);
  if (/insufficient (funds|lamports)|0x1\b/i.test(m)) return 'Saldo tidak cukup untuk transaksi ini (termasuk biaya).';
  if (/blockhash not found|expired/i.test(m)) return 'Transaksi kedaluwarsa, silakan coba lagi.';
  if (/failed to fetch|networkerror/i.test(m)) return 'Gagal terhubung ke jaringan. Periksa internet / RPC.';
  if (/429/.test(m)) return 'Terlalu banyak permintaan ke RPC. Tunggu sebentar lalu coba lagi.';
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

export const conn = () => S.makeConnection(state.settings);
export const net = () => S.NETWORKS[state.settings.network];
export const accounts = () => state.secret.accounts;
export const activeAcc = () => accounts().find((a) => a.index === state.settings.activeAccount) || accounts()[0];
export const keypair = (index = activeAcc().index) => W.keypairForAccount(state.secret, index);
export const address = () => keypair().publicKey.toBase58();

export async function saveSettings() {
  await local.set('settings', state.settings);
}

/** Alamat publik semua akun, dibaca oleh background/content script untuk dApp (tanpa membuka vault). */
export async function syncPublicAccounts() {
  await local.set(
    'publicAccounts',
    accounts().map((a) => ({ index: a.index, name: a.name, address: keypair(a.index).publicKey.toBase58() })),
  );
}

/** Simpan ulang vault terenkripsi (dipakai saat menambah/mengganti nama akun). */
export async function persistSecret(password) {
  await local.set('vault', await W.encryptVault(state.secret, password));
  await session.set('unlocked', { secret: state.secret, lastActive: Date.now() });
  await syncPublicAccounts();
}

export async function touch() {
  if (state.secret) await session.set('unlocked', { secret: state.secret, lastActive: Date.now() });
}

export async function lock() {
  state.secret = null;
  state.portfolio = null;
  await session.remove('unlocked');
  V.unlock();
}

export async function checkPassword(pw) {
  await W.decryptVault(await local.get('vault'), pw);
}

// ---------- Portofolio ----------

/** Saldo SOL + token (dengan metadata) + harga. Disimpan di state.portfolio. */
export async function loadPortfolio() {
  const c = conn();
  const addr = address();
  const network = state.settings.network;
  const [lamports, rawTokens] = await Promise.all([S.getBalance(c, addr), S.getTokenAccounts(c, addr)]);
  const cacheKey = `metaCache:${network}`;
  const cache = (await local.get(cacheKey)) || {};
  const tokens = await S.loadMetadata(c, rawTokens, cache);
  await local.set(cacheKey, cache);
  let prices = null;
  if (!net().test) {
    prices = await M.getPrices(tokens.filter((t) => !t.isNft).map((t) => t.mint), state.settings.currency).catch(() => null);
  }
  state.portfolio = { address: addr, network, lamports, tokens, prices };
  return state.portfolio;
}

export function fiat(value) {
  return M.formatFiat(value, state.settings.currency);
}

export function tokenValue(t) {
  const p = state.portfolio?.prices?.tokens?.[t.mint];
  return p == null ? null : (Number(t.amountRaw) / 10 ** t.decimals) * p;
}

export function solValue(lamports) {
  const p = state.portfolio?.prices?.sol;
  return p == null ? null : (lamports / 1e9) * p;
}

export function tokenLabel(t) {
  return t.symbol || t.name || short(t.mint);
}

export function avatar(t, cls = '') {
  if (t.image) return `<img class="avatar img ${cls}" src="${esc(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return `<span class="avatar ${cls}">${esc((t.symbol || t.name || '?').slice(0, 1))}</span>`;
}

// ---------- Header ----------

export function header(title) {
  const acc = activeAcc();
  return `<header class="bar">
    <button class="acct" id="accts"><span class="avatar">${esc(acc.name.slice(0, 1))}</span><span><b>${esc(acc.name)}</b><small>${short(address())}</small></span></button>
    ${title ? `<h2>${esc(title)}</h2>` : `<span class="net ${net().test ? 'test' : 'main'}">${net().label}</span>`}
    <button class="icon" id="settings" title="Pengaturan">⚙</button>
  </header>`;
}

export function bindHeader() {
  $('#accts').onclick = V.accounts;
  $('#settings').onclick = V.settings;
}

export function simpleHeader(title) {
  return `<header class="bar"><button class="icon" id="back" title="Kembali">←</button><h2>${esc(title)}</h2><span></span></header>`;
}
