import os
from datetime import datetime, timedelta
from typing import Optional
import yfinance as yf
import pandas as pd
from ...utils.symbol_mapper import get_yahoo_symbol, get_yahoo_interval

def _normalize_candle(row, ts) -> dict:
    return {
        "time": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
        "open": round(float(row.get("Open", 0)), 6),
        "high": round(float(row.get("High", 0)), 6),
        "low": round(float(row.get("Low", 0)), 6),
        "close": round(float(row.get("Close", 0)), 6),
        "volume": int(row.get("Volume", 0) or 0),
    }

def get_candles(symbol: str, timeframe: str = "1d", start_date: str = None, end_date: str = None) -> dict:
    try:
        yahoo_sym = get_yahoo_symbol(symbol)
        interval = get_yahoo_interval(timeframe)
        if not start_date:
            start_date = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
        if not end_date:
            end_date = datetime.utcnow().strftime("%Y-%m-%d")
        ticker = yf.Ticker(yahoo_sym)
        df = ticker.history(start=start_date, end=end_date, interval=interval)
        if df.empty:
            return {"success": False, "error": f"No data returned for {symbol}", "candles": []}
        # Resample to 4h if needed
        if timeframe == "4h" and interval == "1h":
            df = df.resample("4h").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}).dropna()
        candles = []
        for ts, row in df.iterrows():
            candles.append(_normalize_candle(row, ts))
        return {"success": True, "candles": candles, "count": len(candles)}
    except Exception as e:
        return {"success": False, "error": str(e), "candles": []}

def get_last_price(symbol: str) -> dict:
    try:
        yahoo_sym = get_yahoo_symbol(symbol)
        ticker = yf.Ticker(yahoo_sym)
        info = ticker.fast_info
        price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
        if price is None:
            hist = ticker.history(period="1d", interval="1m")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
        if price is None:
            return {"success": False, "error": "Price unavailable"}
        return {"success": True, "price": round(float(price), 6), "provider": "yahoo"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def get_eod(symbol: str, date: str = None) -> dict:
    try:
        yahoo_sym = get_yahoo_symbol(symbol)
        if not date:
            date = datetime.utcnow().strftime("%Y-%m-%d")
        end = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        ticker = yf.Ticker(yahoo_sym)
        df = ticker.history(start=date, end=end, interval="1d")
        if df.empty:
            return {"success": False, "error": "No EOD data"}
        row = df.iloc[0]
        return {
            "success": True,
            "open": round(float(row["Open"]), 6),
            "high": round(float(row["High"]), 6),
            "low": round(float(row["Low"]), 6),
            "close": round(float(row["Close"]), 6),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
