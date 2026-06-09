import os
from datetime import datetime, timedelta
from .market_data_cache import get_cache, set_cache, get_cache_status, clear_all_cache
from .providers import yahoo_finance_provider as yahoo
from .providers import alltick_provider as alltick

TTL_CANDLES = int(os.getenv("MARKET_DATA_CACHE_TTL_CANDLES_SECONDS", "3600"))
TTL_LAST_PRICE = int(os.getenv("MARKET_DATA_CACHE_TTL_LAST_PRICE_SECONDS", "300"))
TTL_EOD = 86400

def _ck(*parts) -> str:
    return ":".join(str(p) for p in parts)

def get_candles(symbol: str, timeframe: str = "1d", start_date: str = None, end_date: str = None, refresh: bool = False) -> dict:
    key = _ck("candles", "yahoo", symbol, timeframe, start_date or "default", end_date or "default")
    if not refresh:
        cached = get_cache(key)
        if cached:
            return {**cached, "cached": True}
    result = yahoo.get_candles(symbol, timeframe, start_date, end_date)
    if result.get("success"):
        payload = {"symbol": symbol, "timeframe": timeframe, "provider": "yahoo", "candles": result["candles"], "lastUpdated": datetime.utcnow().isoformat(), "cached": False}
        set_cache(key, payload, TTL_CANDLES)
        return payload
    return {"symbol": symbol, "timeframe": timeframe, "provider": "yahoo", "candles": [], "error": result.get("error"), "cached": False}

def get_last_price(symbol: str, provider: str = "auto", refresh: bool = False) -> dict:
    key = _ck("last_price", symbol)
    if not refresh:
        cached = get_cache(key)
        if cached:
            return {**cached, "cached": True}
    result = None
    used_provider = "yahoo"
    if provider in ("auto", "alltick"):
        at = alltick.get_last_price(symbol)
        if at.get("success"):
            result = at
            used_provider = "alltick"
    if not result:
        yf = yahoo.get_last_price(symbol)
        if yf.get("success"):
            result = yf
            used_provider = "yahoo"
    if result and result.get("success"):
        payload = {"symbol": symbol, "price": result["price"], "bid": result.get("bid"), "ask": result.get("ask"), "provider": used_provider, "lastUpdated": datetime.utcnow().isoformat(), "cached": False}
        set_cache(key, payload, TTL_LAST_PRICE)
        return payload
    cached_stale = get_cache(key)
    if cached_stale:
        return {**cached_stale, "cached": True, "stale": True}
    return {"symbol": symbol, "price": None, "provider": used_provider, "error": "Price unavailable", "cached": False}

def get_eod(symbol: str, date: str = None, refresh: bool = False) -> dict:
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    key = _ck("eod", "yahoo", symbol, d)
    if not refresh:
        cached = get_cache(key)
        if cached:
            return {**cached, "cached": True}
    result = yahoo.get_eod(symbol, d)
    if result.get("success"):
        payload = {"symbol": symbol, "date": d, "provider": "yahoo", **result, "lastUpdated": datetime.utcnow().isoformat(), "cached": False}
        set_cache(key, payload, TTL_EOD)
        return payload
    return {"symbol": symbol, "date": d, "provider": "yahoo", "error": result.get("error"), "cached": False}

def get_provider_status() -> dict:
    return {
        "yahoo": {"available": True},
        "alltick": alltick.get_provider_status(),
        "cache": get_cache_status(),
    }

def refresh_symbol(symbol: str, timeframe: str = "1d", include_candles: bool = True, include_last_price: bool = True) -> dict:
    results = {"symbol": symbol, "refreshed": []}
    if include_last_price:
        results["lastPrice"] = get_last_price(symbol, refresh=True)
        results["refreshed"].append("lastPrice")
    if include_candles:
        start = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
        results["candles"] = get_candles(symbol, timeframe, start, refresh=True)
        results["refreshed"].append("candles")
    return results
