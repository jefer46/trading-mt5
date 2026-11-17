// Service worker: menerima permintaan dari situs (lewat content script),
// memutuskan apakah butuh persetujuan, lalu membuka jendela persetujuan.
// Tidak pernah menyentuh private key — penandatanganan terjadi di jendela persetujuan.

const CHAINS = { devnet: 'solana:devnet', testnet: 'solana:testnet', 'mainnet-beta': 'solana:mainnet' };
const NEEDS_CONNECTION = new Set(['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage']);

const get = async (area, key) => (await chrome.storage[area].get(key))[key];

function rpcError(code, message) {
  return { error: { code, message } };
}

async function accountInfo() {
  const [settings, accounts] = await Promise.all([get('local', 'settings'), get('local', 'publicAccounts')]);
  const s = settings || { network: 'devnet', activeAccount: 0 };
  const acc = (accounts || []).find((a) => a.index === s.activeAccount) || (accounts || [])[0];
  if (!acc) return null;
  return { address: acc.address, chain: CHAINS[s.network] || 'solana:devnet' };
}

async function openApproval(msg, sender, origin) {
  const id = crypto.randomUUID();
  const req = {
    id,
    replyId: msg.id,
    tabId: sender.tab.id,
    frameId: sender.frameId ?? 0,
    origin,
    title: sender.tab.title || '',
    favicon: sender.tab.favIconUrl || '',
    method: msg.method,
    params: msg.params || {},
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [`req:${id}`]: req });

  const width = 380;
  const height = 640;
  let pos = {};
  try {
    const cur = await chrome.windows.getLastFocused();
    pos = { left: Math.max(0, cur.left + cur.width - width - 16), top: cur.top + 72 };
  } catch {
    /* posisi default */
  }
  const win = await chrome.windows.create({ url: `popup.html?request=${id}`, type: 'popup', width, height, focused: true, ...pos });
  await chrome.storage.session.set({ [`req:${id}`]: { ...req, windowId: win.id } });
  return { pending: true };
}

async function handle(msg, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab) return rpcError(4100, 'Unauthorized');
  const origin = sender.origin || new URL(sender.url).origin;
  if (!/^https?:\/\//.test(origin)) return rpcError(4100, 'Origin tidak didukung');

  const sites = (await get('local', 'connectedSites')) || {};
  const connected = Boolean(sites[origin]);

  switch (msg.method) {
    case 'state':
      return { result: connected ? await accountInfo() : null };
    case 'disconnect':
      return { result: true };
    case 'connect': {
      if (!(await get('local', 'vault'))) {
        if (msg.params?.onlyIfTrusted) return rpcError(4001, 'User rejected the request.');
        chrome.windows.create({ url: 'popup.html', type: 'popup', width: 380, height: 640 });
        return rpcError(4001, 'Dompet belum dibuat. Selesaikan penyiapan dompet dulu.');
      }
      if (connected) return { result: await accountInfo() };
      if (msg.params?.onlyIfTrusted) return rpcError(4001, 'User rejected the request.');
      return openApproval(msg, sender, origin);
    }
    case 'signIn':
      if (!(await get('local', 'vault'))) return rpcError(4001, 'Dompet belum dibuat.');
      return openApproval(msg, sender, origin);
    default:
      if (!NEEDS_CONNECTION.has(msg.method)) return rpcError(4200, `Metode tidak didukung: ${msg.method}`);
      if (!connected) return rpcError(4100, 'Situs belum terhubung. Panggil connect() dulu.');
      return openApproval(msg, sender, origin);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'dapp-request') return false;
  handle(msg, sender).then(sendResponse, (e) => sendResponse(rpcError(4900, String(e?.message || e))));
  return true; // respons async
});

// Jendela persetujuan ditutup tanpa jawaban -> tolak permintaannya.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const all = await chrome.storage.session.get(null);
  for (const [key, req] of Object.entries(all)) {
    if (!key.startsWith('req:') || req.windowId !== windowId) continue;
    await chrome.storage.session.remove(key);
    chrome.tabs
      .sendMessage(req.tabId, { type: 'dapp-response', id: req.replyId, error: { code: 4001, message: 'User rejected the request.' } }, { frameId: req.frameId })
      .catch(() => {});
  }
});
