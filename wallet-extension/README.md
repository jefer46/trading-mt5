# Dompet Solana (ekstensi browser)

Dompet crypto **non-custodial** untuk jaringan Solana, berbentuk ekstensi browser
seperti Phantom. Kunci dibuat dan disimpan terenkripsi **di browser Anda sendiri**,
tidak ada server.

> ⚠️ **Proyek belajar, belum diaudit keamanan.** Default memakai **Devnet**
> (SOL gratis untuk uji coba). Jangan simpan dana besar di Mainnet dengan dompet ini.

## Fitur

**Dompet & akun**
- Buat dompet baru (seed phrase 12 kata + verifikasi) atau impor
  (seed phrase / private key base58 dari Phantom/Solflare)
- **Kompatibel dengan Phantom**: seed phrase yang sama menghasilkan alamat yang
  sama (path derivasi `m/44'/501'/n'/0'`)
- Banyak akun dari satu seed phrase, ganti nama akun
- Tampilkan seed phrase / ekspor private key (wajib password)
- Kunci otomatis setelah 15 menit tidak aktif, dan saat browser ditutup

**Aset**
- Saldo SOL + **token SPL & Token-2022** dengan nama, simbol, dan logo
  (metadata Metaplex / Token-2022, plus daftar token populer bawaan)
- **NFT**: galeri, gambar, deskripsi, atribut
- **Nilai dalam USD atau Rupiah** (Mainnet; harga dari CoinGecko & Jupiter)
- Riwayat transaksi (link ke Solana Explorer)

**Transaksi**
- **Kirim** SOL, token, dan NFT (akun token penerima dibuat otomatis bila belum ada)
- **Terima**: alamat + QR code
- **Swap** token lewat Jupiter (Mainnet): rute terbaik, slippage 0.5/1/3%,
  dampak harga, minimum diterima, atau tempel alamat mint token apa pun
- **Staking** SOL native: pilih validator (nama, komisi, total stake), lihat akun
  stake & statusnya, nonaktifkan, dan tarik kembali ke dompet
- Airdrop 1 SOL gratis di Devnet/Testnet

**Koneksi ke dApp** (Jupiter, Magic Eden, Raydium, dll.)
- Mendukung **Wallet Standard** (otomatis muncul di tombol "Connect Wallet"
  situs yang memakai `@solana/wallet-adapter`) dan API lama `window.solana`
- Jendela persetujuan untuk: koneksi, tanda tangan transaksi (satu/banyak),
  tanda tangan & kirim, tanda tangan pesan, dan **Sign In With Solana**
- Sebelum menyetujui transaksi: ringkasan instruksi (kirim SOL/token, peringatan
  untuk *approve* / *set authority* / *assign* yang berbahaya) dan **simulasi
  perubahan saldo**
- Perlindungan: situs harus terhubung dulu sebelum meminta tanda tangan; Sign-In
  dengan domain yang tidak cocok diblokir (anti-phishing); permintaan untuk
  jaringan berbeda dari dompet diblokir; peringatan untuk situs non-HTTPS
- Kelola **Situs yang terhubung** (putuskan satu/semua) di Pengaturan;
  ganti akun/jaringan langsung dikabarkan ke situs

**Jaringan**: Devnet / Testnet / Mainnet, atau RPC kustom (disarankan untuk Mainnet,
misalnya dari Helius/QuickNode, karena RPC publik sering membatasi permintaan).

## Instalasi

Butuh [Node.js](https://nodejs.org) 18+ dan Chrome/Brave/Edge versi 111+.

```bash
cd wallet-extension
npm install
npm run build      # hasilnya di folder dist/
```

Lalu muat ke browser:

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked** → pilih folder `wallet-extension/dist`
4. Pin ikon ◎ di toolbar, lalu klik untuk membuka dompet

Saat mengembangkan, `npm run watch` akan build ulang otomatis; klik ⟳ pada
kartu ekstensi di `chrome://extensions` untuk memuat perubahan (dan muat ulang
tab dApp yang sedang terbuka).

> Jika Phantom juga terpasang, `window.solana` tetap milik Phantom. dApp modern
> (Wallet Standard) akan menampilkan keduanya sebagai pilihan terpisah.

## Mencoba di Devnet

1. Buat dompet → catat seed phrase → buat password
2. Klik **Airdrop** untuk mendapat 1 SOL devnet (jika kena batas, pakai
   <https://faucet.solana.com>)
3. Coba **Kirim** ke akun kedua (**+ Tambah akun**), lalu **Stake** ke validator devnet
4. Coba koneksi dApp di situs yang mendukung devnet, misalnya
   <https://faucet.solana.com> atau contoh di <https://solana.com/developers>

Swap dan nilai rupiah hanya aktif di Mainnet (token Devnet tidak punya harga).

## Keamanan: cara kerjanya

| Bagian | Implementasi |
|---|---|
| Seed phrase | BIP-39 (`@scure/bip39`, sudah diaudit) |
| Derivasi kunci | SLIP-0010 ed25519, diuji dengan test vector resmi |
| Enkripsi vault | AES-256-GCM, kunci dari password via PBKDF2-SHA256 600.000 iterasi (WebCrypto) |
| Penyimpanan | `chrome.storage.local`: hanya vault terenkripsi + alamat publik |
| Saat terbuka | `chrome.storage.session`: di memori, hilang saat browser ditutup, **tidak bisa dibaca content script** |
| Tanda tangan dApp | Hanya di jendela persetujuan (halaman ekstensi). Service worker & skrip di situs tidak pernah memegang kunci |
| Asal permintaan | Ditentukan browser (`sender.origin`), bukan klaim dari situs |
| Halaman | CSP ketat: hanya skrip milik ekstensi sendiri yang boleh jalan |

Seed phrase tidak pernah dikirim ke mana pun. Koneksi keluar hanya ke: RPC Solana
yang dipilih, URL metadata token/NFT (gambar & JSON), CoinGecko dan Jupiter (Mainnet).

## Struktur

```
src/wallet.js        seed phrase, derivasi kunci, enkripsi vault, tanda tangan pesan, SIWS
src/solana.js        RPC: saldo, token+metadata, kirim SOL/token, staking, simulasi, dekode transaksi
src/market.js        harga (CoinGecko, Jupiter) & swap Jupiter
src/storage.js       pembungkus chrome.storage
src/ui.js            state & helper tampilan
src/views/*.js       layar: onboarding, home, kirim, swap, stake, pengaturan, persetujuan dApp
src/popup.*          entry popup (HTML/CSS/JS tanpa framework)
src/background.js    service worker: menerima permintaan dApp, membuka jendela persetujuan
src/content.js       jembatan halaman ↔ ekstensi
src/inpage.js        provider di halaman: Wallet Standard + window.solana
test/                unit test (npm test)
build.mjs            bundle dengan esbuild -> dist/
```

## Pengujian

- `npm test` — unit test: test vector SLIP-0010, enkripsi vault, format angka,
  parser metadata, instruksi token (dibandingkan byte-per-byte dengan library resmi
  `@solana/spl-token`), dekode transaksi, tanda tangan pesan & format SIWS.
- Uji end-to-end dilakukan dengan memuat ekstensi di Chromium, dengan RPC/API
  disimulasikan, termasuk dApp tiruan yang memakai Wallet Standard dan web3.js asli.

## Belum ada

- **Hardware wallet (Ledger)**: butuh perangkat fisik untuk dikembangkan & diuji
- **NFT terkompresi (cNFT)**: butuh RPC dengan DAS API (mis. Helius)
- Buku alamat, notifikasi transaksi masuk, banyak bahasa
- **Audit keamanan independen** sebelum dipakai untuk dana sungguhan
