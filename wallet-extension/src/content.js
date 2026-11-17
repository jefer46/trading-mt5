// Content script (dunia terisolasi): jembatan antara halaman web (inpage.js)
// dan service worker ekstensi. Tidak punya akses ke kunci.

const ORIGIN = location.origin;

function toPage(data) {
  window.postMessage({ target: 'dompet-inpage', ...data }, ORIGIN);
}

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== ORIGIN || e.data?.target !== 'dompet-content') return;
  const { id, method, params } = e.data;
  if (typeof id !== 'string' || typeof method !== 'string') return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'dapp-request', id, method, params });
    if (res?.pending) return; // jawaban datang belakangan dari jendela persetujuan
    toPage({ id, result: res?.result, error: res?.error });
  } catch {
    toPage({ id, error: { code: 4900, message: 'Ekstensi dompet tidak merespons. Muat ulang halaman.' } });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'dapp-response') return;
  toPage({ id: msg.id, result: msg.result, error: msg.error });
});

// Beri tahu halaman bila akun aktif / jaringan / izin situs berubah.
async function pushState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'dapp-request', id: 'state', method: 'state' });
    toPage({ event: 'state', state: res?.result ?? null });
  } catch {
    /* ekstensi dimuat ulang */
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.publicAccounts || changes.connectedSites)) pushState();
});
