# Dompet Solana (ekstensi browser)

Dompet crypto **non-custodial** untuk jaringan Solana, berbentuk ekstensi browser
seperti Phantom. Kunci dibuat dan disimpan terenkripsi **di browser Anda sendiri**,
tidak ada server.

> ⚠️ **Proyek belajar, belum diaudit keamanan.** Default memakai **Devnet**
> (SOL gratis untuk uji coba). Jangan simpan dana besar di Mainnet dengan dompet ini.

## Fitur

- Buat dompet baru (seed phrase 12 kata + verifikasi) atau impor
  (seed phrase / private key base58 dari Phantom/Solflare)
- **Kompatibel dengan Phantom**: seed phrase yang sama menghasilkan alamat yang
  sama (path derivasi `m/44'/501'/n'/0'`)
- Banyak akun dari satu seed phrase, ganti nama akun
- Lihat saldo SOL, token SPL, dan riwayat transaksi (link ke Solana Explorer)
- Kirim SOL (validasi alamat, saldo, biaya + layar konfirmasi)
- Terima: alamat + QR code
- Airdrop 1 SOL gratis di Devnet/Testnet
- Pilih jaringan Devnet / Testnet / Mainnet, atau RPC kustom
- Tampilkan seed phrase / ekspor private key (wajib password)
- Kunci otomatis setelah 15 menit tidak aktif, dan saat browser ditutup

## Instalasi

Butuh [Node.js](https://nodejs.org) 18+.

```bash
cd wallet-extension
npm install
npm run build      # hasilnya di folder dist/
```

Lalu muat ke Chrome / Brave / Edge:

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked** → pilih folder `wallet-extension/dist`
4. Pin ikon ◎ di toolbar, lalu klik untuk membuka dompet

Saat mengembangkan, `npm run watch` akan build ulang otomatis; klik ⟳ pada
kartu ekstensi di `chrome://extensions` untuk memuat perubahan.

## Mencoba di Devnet

1. Buat dompet → catat seed phrase → buat password
2. Klik **Airdrop** untuk mendapat 1 SOL devnet (jika kena batas, pakai
   <https://faucet.solana.com>)
3. Klik **Kirim** ke alamat lain, misalnya akun kedua Anda (**+ Tambah akun**)

## Keamanan: cara kerjanya

| Bagian | Implementasi |
|---|---|
| Seed phrase | BIP-39 (`@scure/bip39`, sudah diaudit) |
| Derivasi kunci | SLIP-0010 ed25519, diuji dengan test vector resmi |
| Enkripsi vault | AES-256-GCM, kunci dari password via PBKDF2-SHA256 600.000 iterasi (WebCrypto) |
| Penyimpanan | `chrome.storage.local` (hanya vault terenkripsi) |
| Saat terbuka | `chrome.storage.session`: di memori, hilang saat browser ditutup |
| Halaman | CSP ketat: hanya skrip milik ekstensi sendiri yang boleh jalan |

Seed phrase tidak pernah dikirim ke mana pun. Satu-satunya koneksi keluar adalah
ke RPC Solana yang dipilih (untuk saldo dan mengirim transaksi yang sudah ditandatangani).

## Struktur

```
src/wallet.js    seed phrase, derivasi kunci, enkripsi vault
src/solana.js    RPC: saldo, token, riwayat, kirim, airdrop
src/storage.js   pembungkus chrome.storage
src/popup.*      tampilan (HTML/CSS/JS tanpa framework)
test/            unit test (npm test)
build.mjs        bundle dengan esbuild -> dist/
```

## Belum ada (ide pengembangan berikutnya)

- **Koneksi ke dApp** (`window.solana`, tombol "Connect Wallet" di situs seperti
  Jupiter/Magic Eden): butuh content script, service worker, dan jendela persetujuan
- Kirim token SPL dan tampilkan NFT
- Nama & logo token (token list), harga dalam USD/IDR
- Swap, staking
- Dukungan hardware wallet (Ledger)
- Audit keamanan sebelum dipakai untuk dana sungguhan
