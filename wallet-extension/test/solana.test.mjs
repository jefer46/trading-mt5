import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as S from '../src/solana.js';
import * as spl from '@solana/spl-token';
import { signMessage, verifyMessage, createSignInMessageText, createMnemonic, keypairFromMnemonic } from '../src/wallet.js';

test('parseUnits / formatUnits presisi tanpa float', () => {
  assert.equal(S.parseUnits('1.5', 9), 1_500_000_000n);
  assert.equal(S.parseUnits('0.000000001', 9), 1n);
  assert.equal(S.parseUnits('123', 6), 123_000_000n);
  assert.equal(S.parseUnits('7', 0), 7n);
  assert.throws(() => S.parseUnits('1.1234567', 6));
  assert.throws(() => S.parseUnits('1.5', 0));
  assert.throws(() => S.parseUnits('-1', 9));
  assert.throws(() => S.parseUnits('abc', 9));
  assert.equal(S.formatUnits(1_500_000_000n, 9), '1.5');
  assert.equal(S.formatUnits('123456789000000', 6), '123,456,789');
  assert.equal(S.formatUnits(1n, 9), '0.000000001');
  assert.equal(S.formatUnits(-5000n, 9), '-0.000005');
  assert.equal(S.formatUnits(1_234_567n, 6, 2), '1.23');
  assert.equal(S.solToLamports('0.25'), 250_000_000);
});

test('parse metadata Metaplex', () => {
  const enc = new TextEncoder();
  const str = (s, pad) => {
    const b = enc.encode(s.padEnd(pad, '\0'));
    const out = new Uint8Array(4 + b.length);
    new DataView(out.buffer).setUint32(0, b.length, true);
    out.set(b, 4);
    return out;
  };
  const parts = [Uint8Array.of(4), new Uint8Array(32), new Uint8Array(32), str('Kucing #1', 32), str('KCG', 10), str('https://x.test/1.json', 200)];
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  assert.deepEqual(S.parseMetaplexMetadata(data), { name: 'Kucing #1', symbol: 'KCG', uri: 'https://x.test/1.json' });
});

test('resolveUri ipfs/ar/https, tolak http', () => {
  assert.equal(S.resolveUri('ipfs://abc'), 'https://ipfs.io/ipfs/abc');
  assert.equal(S.resolveUri('ar://xyz'), 'https://arweave.net/xyz');
  assert.equal(S.resolveUri('https://a.b/c'), 'https://a.b/c');
  assert.equal(S.resolveUri('http://a.b/c'), null);
  assert.equal(S.resolveUri('javascript:alert(1)'), null);
});

test('ATA & instruksi token identik dengan library resmi @solana/spl-token', () => {
  for (const program of [S.PROGRAMS.token, S.PROGRAMS.token2022]) {
    const owner = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const pid = new PublicKey(program);
    assert.equal(
      S.associatedTokenAddress(owner, mint, program).toBase58(),
      spl.getAssociatedTokenAddressSync(mint, owner, false, pid).toBase58(),
    );
    const ours = S.tokenTransferInstructions({ owner, mint, toOwner: to, amountRaw: 987_654_321n, decimals: 6, programId: program });
    const src = spl.getAssociatedTokenAddressSync(mint, owner, false, pid);
    const dst = spl.getAssociatedTokenAddressSync(mint, to, false, pid);
    const ref = [
      spl.createAssociatedTokenAccountIdempotentInstruction(owner, dst, to, mint, pid),
      spl.createTransferCheckedInstruction(src, mint, dst, owner, 987_654_321n, 6, [], pid),
    ];
    const norm = (ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      data: [...ix.data],
    });
    assert.deepEqual(ours.map(norm), ref.map(norm));
  }
});

test('instruksi transfer token: createIdempotent + transferChecked', () => {
  const owner = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const [create, transfer] = S.tokenTransferInstructions({ owner, mint, toOwner: to, amountRaw: 1_234_567n, decimals: 6 });
  assert.equal(create.programId.toBase58(), S.PROGRAMS.ata);
  assert.deepEqual([...create.data], [1]);
  assert.equal(create.keys[1].pubkey.toBase58(), S.associatedTokenAddress(to, mint).toBase58());
  assert.equal(transfer.programId.toBase58(), S.PROGRAMS.token);
  assert.equal(transfer.data[0], 12);
  assert.equal(new DataView(transfer.data.buffer).getBigUint64(1, true), 1_234_567n);
  assert.equal(transfer.data[9], 6);
  assert.equal(transfer.keys[0].pubkey.toBase58(), S.associatedTokenAddress(owner, mint).toBase58());
  assert.ok(transfer.keys[3].isSigner);
  // Token-2022 memakai program & ATA berbeda
  const [c2, t2] = S.tokenTransferInstructions({ owner, mint, toOwner: to, amountRaw: 1n, decimals: 0, programId: S.PROGRAMS.token2022 });
  assert.equal(t2.programId.toBase58(), S.PROGRAMS.token2022);
  assert.notEqual(c2.keys[1].pubkey.toBase58(), create.keys[1].pubkey.toBase58());
});

test('describeTransaction mengenali transfer SOL, token, dan approve berbahaya', () => {
  const payer = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const [, tokenIx] = S.tokenTransferInstructions({ owner: payer.publicKey, mint, toOwner: to, amountRaw: 2_500_000n, decimals: 6 });
  const approve = { ...tokenIx, data: Uint8Array.of(4, 1, 0, 0, 0, 0, 0, 0, 0) };
  approve.programId = tokenIx.programId;
  approve.keys = tokenIx.keys;
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 1_500_000_000 }), tokenIx, approve],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  const round = S.decodeTransaction(vtx.serialize());
  const d = S.describeTransaction(round);
  assert.match(d[0].text, /Kirim 1\.5 SOL/);
  assert.match(d[1].text, /Transfer token 2\.5/);
  assert.ok(d[2].warn);
});

test('signMessage bisa diverifikasi & SIWS format standar', () => {
  const kp = keypairFromMnemonic(createMnemonic(), 0);
  const msg = new TextEncoder().encode('halo dunia');
  const sig = signMessage(kp, msg);
  assert.equal(sig.length, 64);
  assert.ok(verifyMessage(kp.publicKey.toBytes(), msg, sig));
  assert.ok(!verifyMessage(kp.publicKey.toBytes(), new TextEncoder().encode('lain'), sig));

  const text = createSignInMessageText({
    domain: 'contoh.com',
    address: 'ABC',
    statement: 'Masuk ke Contoh',
    uri: 'https://contoh.com',
    version: '1',
    nonce: 'n0nce123',
    issuedAt: '2026-11-17T00:00:00Z',
    resources: ['https://contoh.com/a'],
  });
  assert.equal(
    text,
    'contoh.com wants you to sign in with your Solana account:\nABC\n\nMasuk ke Contoh\n\nURI: https://contoh.com\nVersion: 1\nNonce: n0nce123\nIssued At: 2026-11-17T00:00:00Z\nResources:\n- https://contoh.com/a',
  );
  assert.equal(createSignInMessageText({ domain: 'a.b', address: 'X' }), 'a.b wants you to sign in with your Solana account:\nX');
});
