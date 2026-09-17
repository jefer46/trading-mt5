"""Fetch chart data from a running MetaTrader 5 terminal and run a technical analysis.

Requires the MetaTrader5 terminal to be installed and running (Windows only,
or Wine on Linux/Mac) and logged in to a broker account before this script
is run, since the MetaTrader5 Python package talks to that running terminal.
"""

import argparse
import sys
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd
import ta

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

TIMEFRAME_MAP = {
    "M1": "TIMEFRAME_M1",
    "M5": "TIMEFRAME_M5",
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H4": "TIMEFRAME_H4",
    "D1": "TIMEFRAME_D1",
    "W1": "TIMEFRAME_W1",
    "MN1": "TIMEFRAME_MN1",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Analisa chart MetaTrader 5")
    parser.add_argument("--symbol", default="EURUSD", help="Simbol/pair, contoh: EURUSD, XAUUSD")
    parser.add_argument("--timeframe", default="H1", choices=TIMEFRAME_MAP.keys(), help="Timeframe chart")
    parser.add_argument("--bars", type=int, default=500, help="Jumlah candle yang diambil")
    parser.add_argument("--login", type=int, default=None, help="Nomor akun MT5 (opsional)")
    parser.add_argument("--password", default=None, help="Password akun MT5 (opsional)")
    parser.add_argument("--server", default=None, help="Nama server broker MT5 (opsional)")
    parser.add_argument("--path", default=None, help="Path ke terminal64.exe (opsional)")
    parser.add_argument("--out", default="chart_analysis.png", help="File output chart (PNG)")
    return parser.parse_args()


def connect(args):
    if mt5 is None:
        sys.exit(
            "Package 'MetaTrader5' tidak terpasang atau tidak didukung di OS ini.\n"
            "Package ini hanya berjalan di Windows (atau Wine) tempat terminal MT5 terinstall.\n"
            "Jalankan: pip install MetaTrader5"
        )

    init_kwargs = {}
    if args.path:
        init_kwargs["path"] = args.path
    if args.login:
        init_kwargs["login"] = args.login
    if args.password:
        init_kwargs["password"] = args.password
    if args.server:
        init_kwargs["server"] = args.server

    if not mt5.initialize(**init_kwargs):
        sys.exit(f"Gagal konek ke terminal MT5: {mt5.last_error()}")

    info = mt5.account_info()
    if info is not None:
        print(f"Terhubung ke akun {info.login} ({info.server}), balance={info.balance} {info.currency}")
    else:
        print("Terhubung ke terminal MT5 (tanpa info akun).")


def fetch_rates(symbol, timeframe_name, bars):
    timeframe = getattr(mt5, TIMEFRAME_MAP[timeframe_name])

    if not mt5.symbol_select(symbol, True):
        sys.exit(f"Simbol '{symbol}' tidak ditemukan/tidak bisa diaktifkan di Market Watch.")

    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, bars)
    if rates is None or len(rates) == 0:
        sys.exit(f"Tidak ada data yang didapat untuk {symbol} {timeframe_name}: {mt5.last_error()}")

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")
    df.set_index("time", inplace=True)
    df.rename(columns={"tick_volume": "volume"}, inplace=True)
    return df[["open", "high", "low", "close", "volume"]]


def add_indicators(df):
    df["sma20"] = df["close"].rolling(window=20).mean()
    df["sma50"] = df["close"].rolling(window=50).mean()
    df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()

    df["rsi14"] = ta.momentum.RSIIndicator(df["close"], window=14).rsi()

    macd = ta.trend.MACD(df["close"])
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_diff"] = macd.macd_diff()

    bb = ta.volatility.BollingerBands(df["close"], window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_lower"] = bb.bollinger_lband()

    df["atr14"] = ta.volatility.AverageTrueRange(
        df["high"], df["low"], df["close"], window=14
    ).average_true_range()

    return df


def build_report(df, symbol, timeframe_name):
    last = df.iloc[-1]
    prev = df.iloc[-2]

    lines = []
    lines.append(f"=== Analisa {symbol} ({timeframe_name}) ===")
    lines.append(f"Waktu candle terakhir : {df.index[-1]}")
    lines.append(f"Harga close terakhir  : {last['close']:.5f}")
    lines.append("")

    # Trend berdasarkan SMA20 vs SMA50
    if last["sma20"] > last["sma50"]:
        trend = "UPTREND (SMA20 di atas SMA50)"
    elif last["sma20"] < last["sma50"]:
        trend = "DOWNTREND (SMA20 di bawah SMA50)"
    else:
        trend = "SIDEWAYS"
    lines.append(f"Trend               : {trend}")

    # Golden/Death cross terbaru
    cross = None
    if prev["sma20"] <= prev["sma50"] and last["sma20"] > last["sma50"]:
        cross = "GOLDEN CROSS baru terjadi (sinyal bullish)"
    elif prev["sma20"] >= prev["sma50"] and last["sma20"] < last["sma50"]:
        cross = "DEATH CROSS baru terjadi (sinyal bearish)"
    if cross:
        lines.append(f"Cross signal        : {cross}")

    # RSI
    rsi = last["rsi14"]
    if rsi >= 70:
        rsi_status = "OVERBOUGHT"
    elif rsi <= 30:
        rsi_status = "OVERSOLD"
    else:
        rsi_status = "NETRAL"
    lines.append(f"RSI(14)             : {rsi:.2f} ({rsi_status})")

    # MACD
    if last["macd"] > last["macd_signal"] and prev["macd"] <= prev["macd_signal"]:
        macd_status = "MACD baru cross ke ATAS signal line (bullish)"
    elif last["macd"] < last["macd_signal"] and prev["macd"] >= prev["macd_signal"]:
        macd_status = "MACD baru cross ke BAWAH signal line (bearish)"
    elif last["macd"] > last["macd_signal"]:
        macd_status = "MACD di atas signal line (momentum bullish)"
    else:
        macd_status = "MACD di bawah signal line (momentum bearish)"
    lines.append(f"MACD                : {macd_status}")

    # Bollinger Bands
    if last["close"] >= last["bb_upper"]:
        bb_status = "Harga menyentuh/melewati Upper Band (potensi overbought/reversal)"
    elif last["close"] <= last["bb_lower"]:
        bb_status = "Harga menyentuh/melewati Lower Band (potensi oversold/reversal)"
    else:
        bb_status = "Harga berada di dalam Bollinger Band (normal)"
    lines.append(f"Bollinger Bands     : {bb_status}")

    lines.append(f"ATR(14)             : {last['atr14']:.5f} (ukuran volatilitas)")

    lines.append("")
    lines.append("Catatan: Ini analisa teknikal otomatis berbasis indikator, bukan rekomendasi")
    lines.append("finansial. Selalu gunakan manajemen risiko sendiri sebelum trading.")

    return "\n".join(lines)


def plot_chart(df, symbol, timeframe_name, out_path):
    plot_df = df.tail(150)

    apds = [
        mpf.make_addplot(plot_df["sma20"], color="blue", width=0.8),
        mpf.make_addplot(plot_df["sma50"], color="orange", width=0.8),
        mpf.make_addplot(plot_df["bb_upper"], color="gray", width=0.6, linestyle="--"),
        mpf.make_addplot(plot_df["bb_lower"], color="gray", width=0.6, linestyle="--"),
        mpf.make_addplot(plot_df["rsi14"], panel=2, color="purple", ylabel="RSI"),
        mpf.make_addplot(plot_df["macd"], panel=3, color="blue", ylabel="MACD"),
        mpf.make_addplot(plot_df["macd_signal"], panel=3, color="orange"),
    ]

    mpf.plot(
        plot_df,
        type="candle",
        style="yahoo",
        addplot=apds,
        volume=True,
        panel_ratios=(6, 2, 2, 2),
        title=f"{symbol} - {timeframe_name}",
        savefig=out_path,
    )
    print(f"Chart tersimpan di: {out_path}")


def main():
    args = parse_args()
    connect(args)

    try:
        df = fetch_rates(args.symbol, args.timeframe, args.bars)
        df = add_indicators(df)

        report = build_report(df, args.symbol, args.timeframe)
        print()
        print(report)

        plot_chart(df, args.symbol, args.timeframe, args.out)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
