// Pembungkus penyimpanan. Di ekstensi memakai chrome.storage;
// di luar ekstensi (mis. saat dibuka sebagai halaman biasa untuk dev) memakai localStorage.

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

function webArea(store) {
  return {
    async get(key) {
      const v = store.getItem(key);
      return v == null ? undefined : JSON.parse(v);
    },
    async set(key, value) {
      store.setItem(key, JSON.stringify(value));
    },
    async remove(key) {
      store.removeItem(key);
    },
  };
}

function chromeArea(area) {
  return {
    async get(key) {
      return (await area.get(key))[key];
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

// local: tersimpan permanen (vault terenkripsi + pengaturan)
// session: hilang saat browser ditutup (kunci yang sudah dibuka)
export const local = hasChrome ? chromeArea(chrome.storage.local) : webArea(localStorage);
export const session =
  hasChrome && chrome.storage.session ? chromeArea(chrome.storage.session) : webArea(sessionStorage);
