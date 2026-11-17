// Inti kriptografi dompet: seed phrase, derivasi kunci, dan enkripsi vault.
// Semua kunci dibuat & disimpan LOKAL di browser. Tidak ada yang dikirim ke server.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const HARDENED = 0x80000000;

// ---------- Seed phrase ----------

export function createMnemonic(strength = 128) {
  // 128 bit = 12 kata, 256 bit = 24 kata
  return generateMnemonic(wordlist, strength);
}

export function normalizeMnemonic(m) {
  return m.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidMnemonic(m) {
  return validateMnemonic(normalizeMnemonic(m), wordlist);
}

// ---------- Derivasi HD (SLIP-0010 ed25519) ----------

function ser32(i) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, false);
  return b;
}

/** Derivasi SLIP-0010 untuk ed25519 (hanya mendukung indeks hardened). */
export function deriveEd25519(path, seed) {
  if (!/^m(\/\d+')+$/.test(path)) {
    throw new Error(`Path tidak valid (ed25519 harus hardened semua): ${path}`);
  }
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const seg of path.split('/').slice(1)) {
    const index = (parseInt(seg, 10) + HARDENED) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data.set(key, 1);
    data.set(ser32(index), 33);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

/** Path standar Solana yang dipakai Phantom, Solflare, dll. */
export function solanaPath(accountIndex) {
  return `m/44'/501'/${accountIndex}'/0'`;
}

export function keypairFromMnemonic(mnemonic, accountIndex = 0) {
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic));
  return Keypair.fromSeed(deriveEd25519(solanaPath(accountIndex), seed));
}

/** Impor private key format base58 (64 byte, seperti ekspor dari Phantom) atau array JSON. */
export function keypairFromPrivateKey(input) {
  const s = input.trim();
  let bytes;
  if (s.startsWith('[')) {
    bytes = Uint8Array.from(JSON.parse(s));
  } else {
    bytes = bs58.decode(s);
  }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error('Private key harus 32 atau 64 byte.');
}

export function exportPrivateKey(keypair) {
  return bs58.encode(keypair.secretKey);
}

// ---------- Enkripsi vault (PBKDF2 + AES-GCM, WebCrypto) ----------

const PBKDF2_ITERATIONS = 600_000;

const b64 = {
  enc: (u8) => btoa(String.fromCharCode(...u8)),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function deriveAesKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    v: 1,
    kdf: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt: b64.enc(salt),
    iv: b64.enc(iv),
    ciphertext: b64.enc(ct),
  };
}

export async function decryptVault(vault, password) {
  const key = await deriveAesKey(password, b64.dec(vault.salt), vault.iterations);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64.dec(vault.iv) },
      key,
      b64.dec(vault.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error('Password salah.');
  }
}

// ---------- Bentuk data vault ----------
// { type: 'mnemonic', mnemonic, accounts: [{ index, name }] }
// { type: 'privateKey', secretKey: base58, accounts: [{ index: 0, name }] }

export function keypairForAccount(secret, accountIndex) {
  if (secret.type === 'mnemonic') return keypairFromMnemonic(secret.mnemonic, accountIndex);
  return keypairFromPrivateKey(secret.secretKey);
}
