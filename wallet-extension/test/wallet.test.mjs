import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils';
import {
  deriveEd25519,
  createMnemonic,
  isValidMnemonic,
  keypairFromMnemonic,
  keypairFromPrivateKey,
  exportPrivateKey,
  encryptVault,
  decryptVault,
} from '../src/wallet.js';

// Test vector 1 resmi dari spesifikasi SLIP-0010 (kurva ed25519)
const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));

test('SLIP-0010 ed25519 vector: m/0H', () => {
  assert.equal(
    bytesToHex(deriveEd25519("m/0'", SEED)),
    '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
  );
});

test('SLIP-0010 ed25519 vector: m/0H/1H/2H/2H/1000000000H', () => {
  assert.equal(
    bytesToHex(deriveEd25519("m/0'/1'/2'/2'/1000000000'", SEED)),
    '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
  );
});

test('path non-hardened ditolak', () => {
  assert.throws(() => deriveEd25519("m/44'/501'/0", SEED));
});

test('mnemonic baru valid, 12 kata', () => {
  const m = createMnemonic();
  assert.equal(m.split(' ').length, 12);
  assert.ok(isValidMnemonic(m));
  assert.ok(!isValidMnemonic('abandon abandon abandon'));
});

test('derivasi Solana deterministik & akun berbeda per indeks', () => {
  const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const a0 = keypairFromMnemonic(m, 0);
  const a0b = keypairFromMnemonic('  ' + m.toUpperCase() + ' ', 0);
  const a1 = keypairFromMnemonic(m, 1);
  assert.equal(a0.publicKey.toBase58(), a0b.publicKey.toBase58());
  assert.notEqual(a0.publicKey.toBase58(), a1.publicKey.toBase58());
  // cocok dengan derivasi manual seed -> m/44'/501'/0'/0'
  const seed = mnemonicToSeedSync(m);
  assert.equal(bytesToHex(a0.secretKey.slice(0, 32)), bytesToHex(deriveEd25519("m/44'/501'/0'/0'", seed)));
});

test('ekspor/impor private key bolak-balik', () => {
  const kp = keypairFromMnemonic(createMnemonic(), 0);
  const back = keypairFromPrivateKey(exportPrivateKey(kp));
  assert.equal(back.publicKey.toBase58(), kp.publicKey.toBase58());
  const fromJson = keypairFromPrivateKey(JSON.stringify(Array.from(kp.secretKey)));
  assert.equal(fromJson.publicKey.toBase58(), kp.publicKey.toBase58());
});

test('vault terenkripsi: password benar membuka, salah ditolak', async () => {
  const data = { type: 'mnemonic', mnemonic: createMnemonic(), accounts: [{ index: 0, name: 'Akun 1' }] };
  const vault = await encryptVault(data, 'rahasia-123');
  assert.ok(!JSON.stringify(vault).includes(data.mnemonic.split(' ')[0] + ' '));
  assert.deepEqual(await decryptVault(vault, 'rahasia-123'), data);
  await assert.rejects(decryptVault(vault, 'salah'), /Password salah/);
});
