// Interaksi dengan jaringan Solana lewat RPC.

import {
  Authorized,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';

export const NETWORKS = {
  devnet: { label: 'Devnet', rpc: 'https://api.devnet.solana.com', test: true, chain: 'solana:devnet' },
  testnet: { label: 'Testnet', rpc: 'https://api.testnet.solana.com', test: true, chain: 'solana:testnet' },
  'mainnet-beta': { label: 'Mainnet', rpc: 'https://api.mainnet-beta.solana.com', test: false, chain: 'solana:mainnet' },
};

export const PROGRAMS = {
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  metadata: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  stake: 'Stake11111111111111111111111111111111111111',
  jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  config: 'Config1111111111111111111111111111111111111',
};

const PROGRAM_NAMES = {
  [PROGRAMS.system]: 'System Program',
  [PROGRAMS.token]: 'Token Program',
  [PROGRAMS.token2022]: 'Token-2022',
  [PROGRAMS.ata]: 'Associated Token Account',
  [PROGRAMS.metadata]: 'Metaplex Metadata',
  [PROGRAMS.computeBudget]: 'Compute Budget',
  [PROGRAMS.memo]: 'Memo',
  [PROGRAMS.stake]: 'Stake Program',
  [PROGRAMS.jupiter]: 'Jupiter Aggregator',
};

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Token populer di Mainnet (nama & desimal), dipakai jika metadata on-chain tidak ada. */
export const KNOWN_TOKENS = {
  [WSOL_MINT]: { symbol: 'SOL', name: 'Solana', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk', decimals: 5 },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium', decimals: 6 },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: 'PYTH', name: 'Pyth Network', decimals: 6 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'mSOL', name: 'Marinade staked SOL', decimals: 9 },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'JitoSOL', name: 'Jito Staked SOL', decimals: 9 },
};

export { LAMPORTS_PER_SOL };
export const FEE_LAMPORTS = 5000; // biaya dasar per tanda tangan

export function makeConnection(settings) {
  const url = settings.customRpc?.trim() || NETWORKS[settings.network].rpc;
  return new Connection(url, 'confirmed');
}

export function explorerUrl(kind, id, network) {
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}

export function isValidAddress(s) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(String(s).trim());
    return String(s).trim().length >= 32;
  } catch {
    return false;
  }
}

// ---------- Angka ----------

/** Ubah teks ("1.5") ke unit terkecil (BigInt) tanpa error pembulatan float. */
export function parseUnits(text, decimals) {
  const s = String(text).trim();
  const re = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`) : /^\d+$/;
  if (!re.test(s)) throw new Error(decimals > 0 ? `Jumlah tidak valid (maks ${decimals} desimal).` : 'Jumlah harus bilangan bulat.');
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function formatUnits(raw, decimals, maxFrac = decimals) {
  const v = BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${w}${frac ? `.${frac}` : ''}`;
}

export function solToLamports(text) {
  return Number(parseUnits(text, 9));
}

export function formatSol(lamports) {
  return formatUnits(BigInt(Math.round(Number(lamports))), 9);
}

// ---------- Saldo & token ----------

export async function getBalance(conn, pubkey) {
  return conn.getBalance(new PublicKey(pubkey));
}

export async function getTokenAccounts(conn, owner) {
  const ownerKey = new PublicKey(owner);
  const results = await Promise.all(
    [PROGRAMS.token, PROGRAMS.token2022].map((p) =>
      conn
        .getParsedTokenAccountsByOwner(ownerKey, { programId: new PublicKey(p) })
        .then((r) => r.value.map((v) => ({ ...v, programId: p })))
        .catch(() => []),
    ),
  );
  return results
    .flat()
    .map(({ pubkey, account, programId }) => {
      const info = account.data.parsed.info;
      return {
        account: pubkey.toBase58(),
        mint: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        programId,
      };
    })
    .filter((t) => BigInt(t.amountRaw) > 0n);
}

// ---------- Metadata token (nama, simbol, logo) ----------

function metadataPda(mint) {
  const enc = new TextEncoder();
  const pid = new PublicKey(PROGRAMS.metadata);
  return PublicKey.findProgramAddressSync([enc.encode('metadata'), pid.toBytes(), new PublicKey(mint).toBytes()], pid)[0];
}

/** Parse akun Metaplex Token Metadata: ambil name, symbol, uri. */
export function parseMetaplexMetadata(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 1 + 32 + 32; // key + update authority + mint
  const str = () => {
    const len = view.getUint32(o, true);
    o += 4;
    if (len > 1000 || o + len > data.length) throw new Error('metadata rusak');
    const s = new TextDecoder().decode(data.subarray(o, o + len)).replace(/\0/g, '').trim();
    o += len;
    return s;
  };
  return { name: str(), symbol: str(), uri: str() };
}

export function resolveUri(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return /^https:\/\//.test(uri) ? uri : null;
}

async function fetchJson(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lengkapi daftar token dengan metadata. `cache` adalah objek {mint: meta}
 * yang akan diperbarui (supaya tidak mengambil ulang tiap kali dibuka).
 */
export async function loadMetadata(conn, tokens, cache = {}) {
  const missing = tokens.filter((t) => !cache[t.mint]);
  if (missing.length) {
    const metaAccounts = await conn
      .getMultipleAccountsInfo(missing.map((t) => metadataPda(t.mint)))
      .catch(() => missing.map(() => null));
    const t22 = missing.filter((t) => t.programId === PROGRAMS.token2022);
    const t22Info = t22.length
      ? await conn.getMultipleParsedAccounts(t22.map((t) => new PublicKey(t.mint))).catch(() => ({ value: [] }))
      : { value: [] };

    await Promise.all(
      missing.map(async (t, i) => {
        let meta = null;
        try {
          if (metaAccounts[i]) meta = parseMetaplexMetadata(new Uint8Array(metaAccounts[i].data));
        } catch {
          meta = null;
        }
        if (!meta) {
          const j = t22.indexOf(t);
          const ext = j >= 0 ? t22Info.value[j]?.data?.parsed?.info?.extensions : null;
          const tm = ext?.find((e) => e.extension === 'tokenMetadata')?.state;
          if (tm) meta = { name: tm.name, symbol: tm.symbol, uri: tm.uri };
        }
        const known = KNOWN_TOKENS[t.mint];
        const out = {
          name: meta?.name || known?.name || '',
          symbol: meta?.symbol || known?.symbol || '',
          image: null,
          description: '',
        };
        const url = resolveUri(meta?.uri);
        if (url) {
          try {
            const j = await fetchJson(url);
            out.image = resolveUri(j.image) || null;
            out.description = typeof j.description === 'string' ? j.description.slice(0, 400) : '';
            out.attributes = Array.isArray(j.attributes) ? j.attributes.slice(0, 20) : [];
            if (!out.name && j.name) out.name = String(j.name);
          } catch {
            /* metadata off-chain tidak bisa diambil, abaikan */
          }
        }
        cache[t.mint] = out;
      }),
    );
  }
  return tokens.map((t) => ({ ...t, ...cache[t.mint], isNft: t.decimals === 0 && t.amountRaw === '1' }));
}

// ---------- Riwayat ----------

export async function getActivity(conn, pubkey, limit = 15) {
  return conn.getSignaturesForAddress(new PublicKey(pubkey), { limit });
}

export async function requestAirdrop(conn, pubkey, sol = 1) {
  const sig = await conn.requestAirdrop(new PublicKey(pubkey), sol * LAMPORTS_PER_SOL);
  await waitForConfirmation(conn, sig);
  return sig;
}

// ---------- Mengirim transaksi ----------

/** Polling status (tanpa websocket, lebih andal di ekstensi). */
export async function waitForConfirmation(conn, sig, lastValidBlockHeight, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`Transaksi gagal: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return st;
    if (lastValidBlockHeight) {
      const height = await conn.getBlockHeight();
      if (height > lastValidBlockHeight) throw new Error('Transaksi kedaluwarsa, silakan coba lagi.');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Waktu konfirmasi habis. Cek status di explorer.');
}

/** Rakit, tanda tangani, kirim, dan tunggu konfirmasi. */
export async function sendInstructions(conn, payer, instructions, extraSigners = []) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(payer, ...extraSigners);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await waitForConfirmation(conn, sig, lastValidBlockHeight);
  return sig;
}

export async function sendSol(conn, keypair, to, lamports) {
  return sendInstructions(conn, keypair, [
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(to.trim()), lamports }),
  ]);
}

/** Kirim transaksi yang sudah ditandatangani (VersionedTransaction). */
export async function sendSigned(conn, vtx, { skipPreflight = false } = {}) {
  const sig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight, maxRetries: 3 });
  await waitForConfirmation(conn, sig);
  return sig;
}

// ---------- Token SPL ----------

function u64le(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

export function associatedTokenAddress(owner, mint, programId = PROGRAMS.token) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBytes(), new PublicKey(programId).toBytes(), new PublicKey(mint).toBytes()],
    new PublicKey(PROGRAMS.ata),
  )[0];
}

/** Instruksi transfer token: buat akun token penerima bila belum ada, lalu transferChecked. */
export function tokenTransferInstructions({ owner, mint, toOwner, amountRaw, decimals, programId = PROGRAMS.token }) {
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const toKey = new PublicKey(toOwner);
  const prog = new PublicKey(programId);
  const source = associatedTokenAddress(ownerKey, mintKey, programId);
  const dest = associatedTokenAddress(toKey, mintKey, programId);

  const createAta = new TransactionInstruction({
    programId: new PublicKey(PROGRAMS.ata),
    keys: [
      { pubkey: ownerKey, isSigner: true, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: toKey, isSigner: false, isWritable: false },
      { pubkey: mintKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: prog, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1), // CreateIdempotent
  });

  const data = new Uint8Array(10);
  data[0] = 12; // TransferChecked
  data.set(u64le(amountRaw), 1);
  data[9] = decimals;
  const transfer = new TransactionInstruction({
    programId: prog,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mintKey, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: ownerKey, isSigner: true, isWritable: false },
    ],
    data,
  });
  return [createAta, transfer];
}

export async function sendToken(conn, keypair, token, toOwner, amountRaw) {
  return sendInstructions(
    conn,
    keypair,
    tokenTransferInstructions({
      owner: keypair.publicKey,
      mint: token.mint,
      toOwner: toOwner.trim(),
      amountRaw,
      decimals: token.decimals,
      programId: token.programId,
    }),
  );
}

/** Info mint (desimal & program) — dipakai untuk token yang ditempel manual di swap. */
export async function getMintInfo(conn, mint) {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  const parsed = info.value?.data?.parsed;
  if (!parsed || parsed.type !== 'mint') throw new Error('Alamat ini bukan mint token.');
  return { decimals: parsed.info.decimals, programId: info.value.owner.toBase58() };
}

// ---------- Staking ----------

const U64_MAX = '18446744073709551615';

export async function getValidators(conn, limit = 40) {
  const [{ current }, names] = await Promise.all([conn.getVoteAccounts(), getValidatorNames(conn)]);
  return current
    .filter((v) => v.epochVoteAccount)
    .sort((a, b) => b.activatedStake - a.activatedStake)
    .slice(0, limit)
    .map((v) => ({
      votePubkey: v.votePubkey,
      nodePubkey: v.nodePubkey,
      commission: v.commission,
      activatedStake: v.activatedStake,
      name: names[v.nodePubkey] || '',
    }));
}

/** Nama validator dari program Config (validator-info). Opsional: gagal = tanpa nama. */
async function getValidatorNames(conn) {
  try {
    const accs = await conn.getParsedProgramAccounts(new PublicKey(PROGRAMS.config));
    const out = {};
    for (const { account } of accs) {
      const info = account.data?.parsed?.info;
      const name = info?.configData?.name;
      const identity = info?.keys?.find((k) => k.signer)?.pubkey;
      if (name && identity) out[identity] = String(name).slice(0, 40);
    }
    return out;
  } catch {
    return {};
  }
}

export async function getStakeAccounts(conn, owner) {
  const [accs, epochInfo] = await Promise.all([
    conn.getParsedProgramAccounts(StakeProgram.programId, {
      filters: [{ memcmp: { offset: 44, bytes: new PublicKey(owner).toBase58() } }],
    }),
    conn.getEpochInfo(),
  ]);
  const epoch = epochInfo.epoch;
  return accs.map(({ pubkey, account }) => {
    const info = account.data.parsed?.info;
    const d = info?.stake?.delegation;
    let status = 'inactive';
    if (d) {
      const act = Number(d.activationEpoch);
      const deact = d.deactivationEpoch;
      if (deact !== U64_MAX) status = epoch > Number(deact) ? 'inactive' : 'deactivating';
      else status = act >= epoch ? 'activating' : 'active';
    }
    return {
      address: pubkey.toBase58(),
      lamports: account.lamports,
      voter: d?.voter || null,
      status,
    };
  });
}

export async function stakeSol(conn, keypair, votePubkey, lamports) {
  const stakeAccount = Keypair.generate();
  const owner = keypair.publicKey;
  const create = StakeProgram.createAccount({
    fromPubkey: owner,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(owner, owner),
    lamports,
  });
  const delegate = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: owner,
    votePubkey: new PublicKey(votePubkey),
  });
  const sig = await sendInstructions(conn, keypair, [...create.instructions, ...delegate.instructions], [stakeAccount]);
  return { sig, stakeAccount: stakeAccount.publicKey.toBase58() };
}

export async function stakeRentExempt(conn) {
  return conn.getMinimumBalanceForRentExemption(StakeProgram.space);
}

export async function deactivateStake(conn, keypair, stakeAddress) {
  const tx = StakeProgram.deactivate({ stakePubkey: new PublicKey(stakeAddress), authorizedPubkey: keypair.publicKey });
  return sendInstructions(conn, keypair, tx.instructions);
}

export async function withdrawStake(conn, keypair, stakeAddress, lamports) {
  const tx = StakeProgram.withdraw({
    stakePubkey: new PublicKey(stakeAddress),
    authorizedPubkey: keypair.publicKey,
    toPubkey: keypair.publicKey,
    lamports,
  });
  return sendInstructions(conn, keypair, tx.instructions);
}

// ---------- Analisis transaksi dari dApp ----------

export function decodeTransaction(bytes) {
  return VersionedTransaction.deserialize(bytes);
}

/** Ringkasan instruksi yang mudah dibaca untuk layar persetujuan. */
export function describeTransaction(vtx) {
  const msg = vtx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const key = (i) => (i < keys.length ? keys[i] : null);
  return msg.compiledInstructions.map((ix) => {
    const program = keys[ix.programIdIndex];
    const d = ix.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const out = { program, programName: PROGRAM_NAMES[program] || null, text: null };
    try {
      if (program === PROGRAMS.system && d.length >= 12 && dv.getUint32(0, true) === 2) {
        out.text = `Kirim ${formatSol(Number(dv.getBigUint64(4, true)))} SOL ke ${short(key(ix.accountKeyIndexes[1]))}`;
      } else if ((program === PROGRAMS.token || program === PROGRAMS.token2022) && d[0] === 12 && d.length >= 10) {
        out.text = `Transfer token ${formatUnits(dv.getBigUint64(1, true), d[9])} (mint ${short(key(ix.accountKeyIndexes[1]))})`;
      } else if ((program === PROGRAMS.token || program === PROGRAMS.token2022) && d[0] === 3 && d.length >= 9) {
        out.text = `Transfer token ${dv.getBigUint64(1, true)} unit`;
      } else if ((program === PROGRAMS.token || program === PROGRAMS.token2022) && (d[0] === 4 || d[0] === 13)) {
        out.text = '⚠️ Memberi izin (approve) pihak lain memakai token Anda';
        out.warn = true;
      } else if ((program === PROGRAMS.token || program === PROGRAMS.token2022) && d[0] === 6) {
        out.text = '⚠️ Mengganti pemilik (set authority) akun token';
        out.warn = true;
      } else if (program === PROGRAMS.ata) {
        out.text = 'Buat akun token';
      } else if (program === PROGRAMS.computeBudget) {
        out.text = 'Atur biaya prioritas / compute';
      } else if (program === PROGRAMS.memo) {
        out.text = `Memo: "${new TextDecoder().decode(d).slice(0, 80)}"`;
      } else if (program === PROGRAMS.system && d.length >= 4 && dv.getUint32(0, true) === 1) {
        out.text = '⚠️ Mengganti pemilik (assign) akun';
        out.warn = true;
      }
    } catch {
      /* biarkan text null */
    }
    return out;
  });
}

/** Simulasi transaksi: perkiraan perubahan saldo SOL pemilik. */
export async function simulateBalanceChange(conn, vtx, owner) {
  const ownerKey = new PublicKey(owner);
  const [pre, sim] = await Promise.all([
    conn.getBalance(ownerKey),
    conn.simulateTransaction(vtx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { encoding: 'base64', addresses: [ownerKey.toBase58()] },
    }),
  ]);
  const post = sim.value.accounts?.[0]?.lamports;
  return {
    err: sim.value.err,
    logs: sim.value.logs || [],
    deltaLamports: post == null ? null : post - pre,
  };
}

function short(a) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?';
}
