# MT5 Chart Analysis

Script Python untuk mengambil data chart langsung dari terminal **MetaTrader 5**
dan menjalankan analisa teknikal otomatis (trend, RSI, MACD, Bollinger Bands, ATR),
lengkap dengan chart candlestick yang disimpan sebagai gambar PNG.

## Syarat

- Terminal **MetaTrader 5** sudah terinstall dan **sedang berjalan** di komputer
  yang menjalankan script ini (package `MetaTrader5` hanya bekerja di Windows,
  atau Wine di Linux/Mac, karena berkomunikasi langsung dengan proses terminal).
- Sudah login ke akun broker di terminal MT5 tersebut (atau isi `--login`,
  `--password`, `--server` untuk login otomatis dari script).
- Python 3.9+

## Instalasi

```bash
pip install -r requirements.txt
```

## Penggunaan

```bash
python mt5_analysis.py --symbol EURUSD --timeframe H1 --bars 500
```

Opsi yang tersedia:

| Opsi | Default | Keterangan |
|---|---|---|
| `--symbol` | `EURUSD` | Simbol/pair, contoh: `EURUSD`, `XAUUSD`, `BTCUSD` |
| `--timeframe` | `H1` | Salah satu: `M1, M5, M15, M30, H1, H4, D1, W1, MN1` |
| `--bars` | `500` | Jumlah candle historis yang diambil |
| `--login` | - | Nomor akun MT5 (opsional, jika belum login di terminal) |
| `--password` | - | Password akun (opsional) |
| `--server` | - | Nama server broker (opsional) |
| `--path` | - | Path ke `terminal64.exe` jika perlu dijalankan manual |
| `--out` | `chart_analysis.png` | Nama file chart hasil analisa |

## Output

1. **Ringkasan analisa** dicetak ke terminal: trend (SMA20 vs SMA50), sinyal
   golden/death cross, status RSI(14), momentum MACD, posisi harga terhadap
   Bollinger Bands, dan ATR(14) sebagai ukuran volatilitas.
2. **Chart candlestick** (`chart_analysis.png` secara default) dengan overlay
   SMA20/SMA50/Bollinger Bands, plus panel volume, RSI, dan MACD di bawahnya.

## Catatan

Analisa yang dihasilkan bersifat teknikal berbasis indikator standar, **bukan**
rekomendasi atau saran finansial. Selalu terapkan manajemen risiko sendiri
sebelum mengambil keputusan trading.

## Proyek lain di repo ini

- [`wallet-extension/`](wallet-extension/): dompet crypto Solana berbentuk ekstensi
  browser (mirip Phantom). Lihat README di folder tersebut.
