// Interaksi dengan jaringan Solana lewat RPC.

import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

export const NETWORKS = {
  devnet: { label: 'Devnet', rpc: 'https://api.devnet.solana.com', test: true },
  testnet: { label: 'Testnet', rpc: 'https://api.testnet.solana.com', test: true },
  'mainnet-beta': { label: 'Mainnet', rpc: 'https://api.mainnet-beta.solana.com', test: false },
};

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

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
    new PublicKey(s.trim());
    return s.trim().length >= 32;
  } catch {
    return false;
  }
}

export async function getBalance(conn, pubkey) {
  return conn.getBalance(new PublicKey(pubkey));
}

export async function getTokens(conn, pubkey) {
  const owner = new PublicKey(pubkey);
  const results = await Promise.all(
    [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) =>
      conn.getParsedTokenAccountsByOwner(owner, { programId }).catch(() => ({ value: [] })),
    ),
  );
  return results
    .flatMap((r) => r.value)
    .map(({ account }) => {
      const info = account.data.parsed.info;
      return {
        mint: info.mint,
        amount: info.tokenAmount.uiAmountString,
        decimals: info.tokenAmount.decimals,
      };
    })
    .filter((t) => Number(t.amount) > 0);
}

export async function getActivity(conn, pubkey, limit = 10) {
  return conn.getSignaturesForAddress(new PublicKey(pubkey), { limit });
}

export async function requestAirdrop(conn, pubkey, sol = 1) {
  const sig = await conn.requestAirdrop(new PublicKey(pubkey), sol * LAMPORTS_PER_SOL);
  await waitForConfirmation(conn, sig);
  return sig;
}

/** Kirim SOL. `lamports` berupa integer. */
export async function sendSol(conn, keypair, to, lamports) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(to.trim()),
      lamports,
    }),
  );
  tx.sign(keypair);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await waitForConfirmation(conn, sig, lastValidBlockHeight);
  return sig;
}

/** Polling status (tanpa websocket, lebih andal di ekstensi). */
export async function waitForConfirmation(conn, sig, lastValidBlockHeight, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`Transaksi gagal: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      return st;
    }
    if (lastValidBlockHeight) {
      const height = await conn.getBlockHeight();
      if (height > lastValidBlockHeight) throw new Error('Transaksi kedaluwarsa, silakan coba lagi.');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Waktu konfirmasi habis. Cek status di explorer.');
}

/** Ubah teks SOL ("1.5") ke lamports tanpa error pembulatan float. */
export function solToLamports(text) {
  const s = String(text).trim();
  if (!/^\d+(\.\d{0,9})?$/.test(s)) throw new Error('Jumlah tidak valid (maks 9 desimal).');
  const [whole, frac = ''] = s.split('.');
  return Number(BigInt(whole) * 1_000_000_000n + BigInt(frac.padEnd(9, '0')));
}

export function formatSol(lamports) {
  const v = lamports / LAMPORTS_PER_SOL;
  return v.toLocaleString('en-US', { maximumFractionDigits: 9 });
}
