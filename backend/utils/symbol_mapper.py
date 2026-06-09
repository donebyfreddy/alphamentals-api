SYMBOL_MAP = {
    "GBPUSD": {"yahoo": "GBPUSD=X", "alltick": "GBPUSD"},
    "EURUSD": {"yahoo": "EURUSD=X", "alltick": "EURUSD"},
    "USDJPY": {"yahoo": "JPY=X",    "alltick": "USDJPY"},
    "XAUUSD": {"yahoo": "GC=F",     "alltick": "XAUUSD"},
    "AUDUSD": {"yahoo": "AUDUSD=X", "alltick": "AUDUSD"},
    "USDCAD": {"yahoo": "USDCAD=X", "alltick": "USDCAD"},
    "GBPJPY": {"yahoo": "GBPJPY=X", "alltick": "GBPJPY"},
}
SUPPORTED_SYMBOLS = list(SYMBOL_MAP.keys())

TIMEFRAME_MAP = {
    "1m": "1m", "5m": "5m", "15m": "15m",
    "30m": "30m", "1h": "1h", "4h": "1h",
    "1d": "1d", "1w": "1wk",
}

def get_yahoo_symbol(symbol: str) -> str:
    return SYMBOL_MAP.get(symbol.upper(), {}).get("yahoo", symbol)

def get_alltick_symbol(symbol: str) -> str:
    return SYMBOL_MAP.get(symbol.upper(), {}).get("alltick", symbol)

def get_yahoo_interval(timeframe: str) -> str:
    return TIMEFRAME_MAP.get(timeframe, "1d")
