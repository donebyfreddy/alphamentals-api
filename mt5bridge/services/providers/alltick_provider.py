import os, time
import requests
from ...utils.symbol_mapper import get_alltick_symbol

ALLTICK_API_KEY = os.getenv("ALLTICK_API_KEY", "")
ALLTICK_BASE = "https://quote.alltick.io/quote-b-api"  # adjust if needed
_last_call_times: list[float] = []
MAX_CALLS_PER_MINUTE = 10

def _available() -> bool:
    return bool(ALLTICK_API_KEY)

def _rate_ok() -> bool:
    now = time.time()
    recent = [t for t in _last_call_times if now - t < 60]
    _last_call_times.clear()
    _last_call_times.extend(recent)
    return len(recent) < MAX_CALLS_PER_MINUTE

def _record_call():
    _last_call_times.append(time.time())

def get_last_price(symbol: str) -> dict:
    if not _available():
        return {"success": False, "error": "AllTick API key not configured", "provider": "alltick"}
    if not _rate_ok():
        return {"success": False, "error": "AllTick rate limit reached — use cached data", "provider": "alltick"}
    try:
        at_sym = get_alltick_symbol(symbol)
        _record_call()
        resp = requests.get(
            f"{ALLTICK_BASE}/trade-tick",
            params={"token": ALLTICK_API_KEY, "query": f'{{"trace":"1","data":{{"code":"{at_sym}"}}}}'},
            timeout=5,
        )
        data = resp.json()
        tick = data.get("data", {}).get("tick_list", [{}])[0] if data.get("data") else {}
        price = tick.get("price") or tick.get("last_price")
        if price:
            return {"success": True, "price": round(float(price), 6), "bid": tick.get("bid"), "ask": tick.get("ask"), "provider": "alltick"}
        return {"success": False, "error": "No price in response", "provider": "alltick"}
    except Exception as e:
        return {"success": False, "error": str(e), "provider": "alltick"}

def get_provider_status() -> dict:
    return {
        "configured": _available(),
        "rate_ok": _rate_ok(),
        "calls_last_minute": len([t for t in _last_call_times if time.time() - t < 60]),
    }
