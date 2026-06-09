import time, json, os
from typing import Any, Optional

_cache: dict[str, dict] = {}
FILE_CACHE_ENABLED = os.getenv("MARKET_DATA_USE_FILE_CACHE", "true").lower() == "true"
FILE_CACHE_PATH = os.getenv("MARKET_DATA_FILE_CACHE_PATH", "./cache/market_data")

def _cache_key(*parts) -> str:
    return ":".join(str(p) for p in parts)

def _file_path(key: str) -> str:
    safe = key.replace(":", "_").replace("/", "-")
    return os.path.join(FILE_CACHE_PATH, f"{safe}.json")

def _load_file(key: str) -> Optional[dict]:
    if not FILE_CACHE_ENABLED:
        return None
    try:
        p = _file_path(key)
        if os.path.exists(p):
            with open(p) as f:
                return json.load(f)
    except Exception:
        pass
    return None

def _save_file(key: str, entry: dict) -> None:
    if not FILE_CACHE_ENABLED:
        return
    try:
        os.makedirs(FILE_CACHE_PATH, exist_ok=True)
        with open(_file_path(key), "w") as f:
            json.dump(entry, f)
    except Exception:
        pass

def get_cache(key: str) -> Optional[Any]:
    entry = _cache.get(key) or _load_file(key)
    if entry:
        _cache[key] = entry
        if time.time() < entry.get("expires_at", 0):
            return entry.get("data")
    return None

def set_cache(key: str, data: Any, ttl: int) -> None:
    entry = {"data": data, "expires_at": time.time() + ttl, "set_at": time.time()}
    _cache[key] = entry
    _save_file(key, entry)

def is_cache_valid(key: str) -> bool:
    return get_cache(key) is not None

def clear_cache(key: str) -> None:
    _cache.pop(key, None)
    try:
        p = _file_path(key)
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        pass

def clear_all_cache() -> None:
    _cache.clear()
    if FILE_CACHE_ENABLED and os.path.exists(FILE_CACHE_PATH):
        for f in os.listdir(FILE_CACHE_PATH):
            try:
                os.remove(os.path.join(FILE_CACHE_PATH, f))
            except Exception:
                pass

def get_cache_status() -> dict:
    now = time.time()
    entries = []
    for k, v in _cache.items():
        entries.append({"key": k, "valid": now < v.get("expires_at", 0), "set_at": v.get("set_at")})
    return {"count": len(entries), "entries": entries}
