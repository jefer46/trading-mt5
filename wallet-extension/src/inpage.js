// Provider yang disuntikkan ke halaman web (dunia MAIN).
// Mendukung Wallet Standard (dipakai @solana/wallet-adapter modern) dan API lama `window.solana`.
// Tidak ada rahasia di sini: semua permintaan diteruskan ke ekstensi dan butuh persetujuan pengguna.

import bs58 from 'bs58';

(() => {
  if (window.__dompetSolana) return;
  Object.defineProperty(window, '__dompetSolana', { value: true });

  const ORIGIN = location.origin;
  const NAME = 'Dompet Solana';
  const CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet'];
  const ICON =
    'data:image/svg+xml;base64,' +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ab9ff2"/><stop offset="1" stop-color="#5a46d6"/></linearGradient></defs><circle cx="64" cy="64" r="64" fill="url(#g)"/><circle cx="64" cy="64" r="30" fill="none" stroke="#fff" stroke-width="9"/><circle cx="64" cy="64" r="10" fill="#fff"/></svg>',
    );

  const b64e = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ---------- Transport ----------

  const pending = new Map();
  let seq = 0;

  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2)}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ target: 'dompet-content', id, method, params }, ORIGIN);
    });
  }

  class WalletError extends Error {
    constructor({ code, message }) {
      super(message);
      this.code = code;
      this.name = 'WalletError';
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== ORIGIN || e.data?.target !== 'dompet-inpage') return;
    const d = e.data;
    if (d.event === 'state') return onState(d.state);
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) p.reject(new WalletError(d.error));
    else p.resolve(d.result);
  });

  // ---------- State akun ----------

  const SOLANA_FEATURES = ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage', 'solana:signIn'];
  let account = null; // StandardAccount
  const standardListeners = { change: new Set() };
  const legacyListeners = {};

  function makeAccount(address) {
    const publicKey = bs58.decode(address);
    return Object.freeze({
      address,
      get publicKey() {
        return publicKey.slice();
      },
      chains: CHAINS.slice(),
      features: SOLANA_FEATURES.slice(),
      label: NAME,
      icon: ICON,
    });
  }

  function legacyKey(address) {
    const bytes = bs58.decode(address);
    return Object.freeze({
      toBase58: () => address,
      toString: () => address,
      toJSON: () => address,
      toBytes: () => bytes.slice(),
      toBuffer: () => bytes.slice(),
      equals: (o) => (o?.toBase58 ? o.toBase58() : String(o)) === address,
    });
  }

  function emitStandard(props) {
    for (const l of standardListeners.change) {
      try {
        l(props);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function emitLegacy(event, ...args) {
    for (const l of legacyListeners[event] || []) {
      try {
        l(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function setAccount(info) {
    if (!info?.address) return;
    if (account?.address === info.address) return;
    const first = !account;
    account = makeAccount(info.address);
    legacy.publicKey = legacyKey(info.address);
    legacy.isConnected = true;
    emitStandard({ accounts: wallet.accounts });
    if (first) emitLegacy('connect', legacy.publicKey);
    else emitLegacy('accountChanged', legacy.publicKey);
  }

  function clearAccount() {
    if (!account) return;
    account = null;
    legacy.publicKey = null;
    legacy.isConnected = false;
    emitStandard({ accounts: [] });
    emitLegacy('disconnect');
  }

  function onState(s) {
    if (!account) return; // situs belum connect di sesi ini
    if (!s) clearAccount();
    else setAccount(s);
  }

  function requireAccount(input) {
    if (!account) throw new WalletError({ code: 4100, message: 'Wallet belum terhubung.' });
    if (input?.account && input.account.address !== account.address) {
      throw new WalletError({ code: 4100, message: 'Akun tidak sesuai dengan akun aktif di dompet.' });
    }
  }

  // ---------- Wallet Standard ----------

  const wallet = {
    version: '1.0.0',
    name: NAME,
    icon: ICON,
    chains: CHAINS.slice(),
    get accounts() {
      return account ? [account] : [];
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async ({ silent } = {}) => {
          try {
            setAccount(await request('connect', { onlyIfTrusted: Boolean(silent) }));
          } catch (err) {
            if (!silent) throw err;
          }
          return { accounts: wallet.accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          await request('disconnect').catch(() => {});
          clearAccount();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event, listener) => {
          standardListeners[event]?.add(listener);
          return () => standardListeners[event]?.delete(listener);
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => {
          inputs.forEach(requireAccount);
          const res = await request('signTransaction', {
            transactions: inputs.map((i) => b64e(i.transaction)),
            chain: inputs[0]?.chain,
          });
          return res.signedTransactions.map((t) => ({ signedTransaction: b64d(t) }));
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          inputs.forEach(requireAccount);
          const res = await request('signAndSendTransaction', {
            transactions: inputs.map((i) => b64e(i.transaction)),
            chain: inputs[0]?.chain,
            options: inputs[0]?.options || {},
          });
          return res.signatures.map((s) => ({ signature: bs58.decode(s) }));
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          const out = [];
          for (const input of inputs) {
            requireAccount(input);
            const res = await request('signMessage', { message: b64e(input.message) });
            out.push({ signedMessage: input.message, signature: b64d(res.signature) });
          }
          return out;
        },
      },
      'solana:signIn': {
        version: '1.0.0',
        signIn: async (...inputs) => {
          const out = [];
          for (const input of inputs.length ? inputs : [{}]) {
            const res = await request('signIn', { input: input || {} });
            setAccount(res);
            out.push({
              account,
              signedMessage: b64d(res.signedMessage),
              signature: b64d(res.signature),
              signatureType: 'ed25519',
            });
          }
          return out;
        },
      },
    },
  };

  class RegisterWalletEvent extends Event {
    #detail;
    get detail() {
      return this.#detail;
    }
    get type() {
      return 'wallet-standard:register-wallet';
    }
    constructor(callback) {
      super('wallet-standard:register-wallet', { bubbles: false, cancelable: false, composed: false });
      this.#detail = callback;
    }
    preventDefault() {
      throw new Error('preventDefault cannot be called');
    }
    stopImmediatePropagation() {
      throw new Error('stopImmediatePropagation cannot be called');
    }
    stopPropagation() {
      throw new Error('stopPropagation cannot be called');
    }
  }

  const registerCallback = ({ register }) => register(wallet);
  try {
    window.dispatchEvent(new RegisterWalletEvent(registerCallback));
  } catch (err) {
    console.error('wallet-standard:register-wallet event could not be dispatched', err);
  }
  try {
    window.addEventListener('wallet-standard:app-ready', ({ detail: api }) => registerCallback(api));
  } catch (err) {
    console.error('wallet-standard:app-ready event listener could not be added', err);
  }

  // ---------- API lama: window.solana ----------

  function serializeTx(tx) {
    if (tx instanceof Uint8Array) return tx;
    if (typeof tx?.version !== 'undefined' && tx.message) return tx.serialize(); // VersionedTransaction
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }); // Transaction lama
  }

  /** Pasang tanda tangan ke objek transaksi milik dApp (web3.js), atau kembalikan bytes. */
  function applySignature(tx, signedB64, sigB64) {
    const sig = b64d(sigB64);
    if (tx instanceof Uint8Array) return b64d(signedB64);
    const addr = account.address;
    if (typeof tx?.version !== 'undefined' && tx.message) {
      const key = tx.message.staticAccountKeys.find((k) => k.toBase58() === addr);
      tx.addSignature(key, sig);
      return tx;
    }
    const entry = tx.signatures.find((s) => s.publicKey.toBase58() === addr);
    tx.addSignature(entry.publicKey, sig);
    return tx;
  }

  async function signLegacy(txs) {
    requireAccount();
    const res = await request('signAllTransactions', { transactions: txs.map((t) => b64e(serializeTx(t))) });
    return txs.map((tx, i) => applySignature(tx, res.signedTransactions[i], res.signatures[i]));
  }

  const legacy = {
    isDompet: true,
    publicKey: null,
    isConnected: false,
    async connect(opts) {
      setAccount(await request('connect', { onlyIfTrusted: Boolean(opts?.onlyIfTrusted) }));
      return { publicKey: legacy.publicKey };
    },
    async disconnect() {
      await request('disconnect').catch(() => {});
      clearAccount();
    },
    async signTransaction(tx) {
      return (await signLegacy([tx]))[0];
    },
    async signAllTransactions(txs) {
      return signLegacy(txs);
    },
    async signAndSendTransaction(tx, options) {
      requireAccount();
      const res = await request('signAndSendTransaction', { transactions: [b64e(serializeTx(tx))], options: options || {} });
      return { signature: res.signatures[0], publicKey: legacy.publicKey };
    },
    async signMessage(message, display) {
      requireAccount();
      const bytes = message instanceof Uint8Array ? message : new TextEncoder().encode(String(message));
      const res = await request('signMessage', { message: b64e(bytes), display });
      return { signature: b64d(res.signature), publicKey: legacy.publicKey };
    },
    async signIn(input) {
      const [out] = await wallet.features['solana:signIn'].signIn(input || {});
      return { address: legacy.publicKey, signedMessage: out.signedMessage, signature: out.signature };
    },
    on(event, listener) {
      (legacyListeners[event] ||= new Set()).add(listener);
      return legacy;
    },
    off(event, listener) {
      legacyListeners[event]?.delete(listener);
      return legacy;
    },
    removeListener(event, listener) {
      return legacy.off(event, listener);
    },
    removeAllListeners(event) {
      if (event) delete legacyListeners[event];
      else for (const k of Object.keys(legacyListeners)) delete legacyListeners[k];
      return legacy;
    },
  };

  Object.defineProperty(window, 'dompet', { value: Object.freeze({ solana: legacy }) });
  // Jangan menimpa dompet lain (mis. Phantom) yang sudah memasang window.solana.
  if (!('solana' in window)) {
    try {
      Object.defineProperty(window, 'solana', { value: legacy, configurable: true });
    } catch {
      /* abaikan */
    }
  }
})();
