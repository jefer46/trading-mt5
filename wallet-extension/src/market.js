// Harga (USD/IDR) dan swap lewat Jupiter. Hanya relevan di Mainnet.

import { VersionedTransaction } from '@solana/web3.js';
import { WSOL_MINT } from './solana.js';

export const API = {
  coingecko: 'https://api.coingecko.com/api/v3/simple/price',
  jupPrice: 'https://lite-api.jup.ag/price/v3',
  jupSwap: 'https://lite-api.jup.ag/swap/v1',
};

export const CURRENCIES = {
  usd: { label: 'USD', locale: 'en-US', code: 'USD' },
  idr: { label: 'IDR', locale: 'id-ID', code: 'IDR' },
};

export function formatFiat(value, currency) {
  if (value == null || Number.isNaN(value)) return '';
  const c = CURRENCIES[currency];
  return new Intl.NumberFormat(c.locale, {
    style: 'currency',
    currency: c.code,
    maximumFractionDigits: currency === 'idr' ? 0 : value < 1 ? 4 : 2,
  }).format(value);
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j.error || j.message || msg;
    } catch {
      /* abaikan */
    }
    throw new Error(msg);
  }
  return r.json();
}

let priceCache = { at: 0, key: '', data: null };

/**
 * Harga dalam mata uang pilihan. Hasil: { sol: number, tokens: { mint: number } }.
 * Harga token diambil dalam USD dari Jupiter lalu dikonversi pakai kurs dari harga SOL.
 */
export async function getPrices(mints, currency) {
  const key = `${currency}:${[...mints].sort().join(',')}`;
  if (priceCache.key === key && Date.now() - priceCache.at < 60_000) return priceCache.data;

  const gecko = await getJson(`${API.coingecko}?ids=solana&vs_currencies=usd,idr`);
  const solUsd = gecko.solana.usd;
  const solCur = gecko.solana[currency];
  const rate = solCur / solUsd;

  const tokens = {};
  const ids = mints.filter((m) => m !== WSOL_MINT);
  if (ids.length) {
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const j = await getJson(`${API.jupPrice}?ids=${chunk.join(',')}`);
        for (const m of chunk) {
          const usd = j[m]?.usdPrice ?? j.data?.[m]?.price;
          if (usd != null) tokens[m] = Number(usd) * rate;
        }
      }
    } catch {
      /* harga token opsional */
    }
  }
  tokens[WSOL_MINT] = solCur;
  const data = { sol: solCur, tokens };
  priceCache = { at: Date.now(), key, data };
  return data;
}

// ---------- Swap (Jupiter) ----------

export async function getQuote({ inputMint, outputMint, amountRaw, slippageBps }) {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amountRaw),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true',
  });
  return getJson(`${API.jupSwap}/quote?${q}`);
}

export async function getSwapTransaction(quote, userPublicKey) {
  const j = await getJson(`${API.jupSwap}/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!j.swapTransaction) throw new Error('Jupiter tidak mengembalikan transaksi.');
  const bytes = Uint8Array.from(atob(j.swapTransaction), (c) => c.charCodeAt(0));
  return VersionedTransaction.deserialize(bytes);
}
