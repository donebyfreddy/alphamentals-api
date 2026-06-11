import os
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI(title="Alphamentals MT5 Bridge", version="2.0.0")

# CORS: accept requests from the local Node API only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3001", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _check_api_key(x_api_key: str | None, required: bool = True):
    expected = os.getenv("MT5_API_KEY", "").strip()
    if not expected:
        return  # disabled when env var is unset
    if not x_api_key or x_api_key != expected:
        raise HTTPException(status_code=401, detail={"ok": False, "error": "Invalid or missing x-api-key header."})


# ---------------------------------------------------------------------------
# Liveness — bridge is alive, no MT5 check
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"ok": True, "service": "mt5-bridge", "version": "2.0.0"}


@app.get("/health")
def health(x_api_key: str | None = Header(default=None)):
    """Bridge liveness only. Returns ok=true whenever the FastAPI process is running.
    Does NOT check whether MetaTrader 5 terminal is running — use /api/v1/terminal/health for that."""
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import health as svc_health
    result = svc_health()
    return {
        "ok": True,
        "service": "mt5-bridge",
        "status": "online",
        "mt5PackageAvailable": result.get("healthy", False),
        "terminalPath": result.get("terminalPath"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/status")
def status(x_api_key: str | None = Header(default=None)):
    """Deep diagnostics: MT5 init state, terminal info, connected account."""
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import _load_mt5, _build_connection_kwargs

    try:
        mt5 = _load_mt5()
    except Exception as exc:
        return {"ok": False, "mt5Initialized": False, "error": str(exc), "timestamp": datetime.now(timezone.utc).isoformat()}

    try:
        if not mt5.initialize(**_build_connection_kwargs(5000)):
            code, message = mt5.last_error()
            return {"ok": False, "mt5Initialized": False, "error": message, "mt5Code": code, "timestamp": datetime.now(timezone.utc).isoformat()}
        try:
            terminal = mt5.terminal_info()
            account = mt5.account_info()
            return {
                "ok": True,
                "mt5Initialized": True,
                "terminal": {
                    "name": getattr(terminal, "name", None),
                    "path": getattr(terminal, "path", None),
                    "connected": bool(getattr(terminal, "connected", False)),
                    "tradeAllowed": bool(getattr(terminal, "trade_allowed", False)),
                },
                "account": {
                    "login": str(account.login),
                    "server": account.server,
                    "broker": getattr(account, "company", None),
                    "balance": float(account.balance),
                    "currency": account.currency,
                } if account else None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        finally:
            mt5.shutdown()
    except Exception as exc:
        logger.exception("MT5 status check failed")
        return {"ok": False, "mt5Initialized": False, "error": str(exc), "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/positions")
def positions(x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import get_positions

    try:
        return {
            "ok": True,
            "positions": get_positions(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.exception("MT5 positions fetch failed")
        return {"ok": False, "positions": [], "error": str(exc), "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/history")
def history(x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import get_history

    try:
        return {
            "ok": True,
            "history": get_history(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.exception("MT5 history fetch failed")
        return {"ok": False, "history": [], "error": str(exc), "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Symbol resolution
# ---------------------------------------------------------------------------

_SYMBOL_ALIASES: dict[str, list[str]] = {
    "XAUUSD": ["XAUUSD", "GOLD", "XAUUSD.", "XAU/USD"],
    "EURUSD": ["EURUSD", "EURUSD.", "EUR/USD"],
    "GBPUSD": ["GBPUSD", "GBPUSD.", "GBP/USD"],
    "USDJPY": ["USDJPY", "USDJPY.", "USD/JPY"],
    "USOIL":  ["USOIL", "WTI", "USOIL.", "WTICOUSD", "CL-OIL"],
    "DXY":    ["DXY", "USDX", "DX-Y.NYB"],
}


def _resolve_symbol(mt5: Any, symbol: str) -> str | None:
    if mt5.symbol_info(symbol) is not None:
        mt5.symbol_select(symbol, True)
        return symbol
    for alias in _SYMBOL_ALIASES.get(symbol, []):
        if mt5.symbol_info(alias) is not None:
            mt5.symbol_select(alias, True)
            return alias
    found = mt5.symbols_get(symbol) or []
    if found:
        mt5.symbol_select(found[0].name, True)
        return found[0].name
    return None


# ---------------------------------------------------------------------------
# Quotes  — GET /quotes?symbols=XAUUSD,EURUSD,GBPUSD
# ---------------------------------------------------------------------------

@app.get("/quotes")
def quotes(
    symbols: str = Query(..., description="Comma-separated symbols, e.g. XAUUSD,EURUSD"),
    x_api_key: str | None = Header(default=None),
):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import _load_mt5, _build_connection_kwargs

    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail={"ok": False, "error": "No symbols provided."})

    timestamp = datetime.now(timezone.utc).isoformat()
    data: dict[str, Any] = {}
    errors: dict[str, str] = {}

    try:
        mt5 = _load_mt5()
    except Exception as exc:
        return {"ok": False, "data": {}, "errors": {s: str(exc) for s in symbol_list}, "timestamp": timestamp}

    try:
        if not mt5.initialize(**_build_connection_kwargs(5000)):
            _, message = mt5.last_error()
            return {"ok": False, "data": {}, "errors": {s: f"MT5 not running: {message}" for s in symbol_list}, "timestamp": timestamp}

        for symbol in symbol_list:
            resolved = _resolve_symbol(mt5, symbol)
            if resolved is None:
                data[symbol] = {"bid": None, "ask": None, "last": None, "updatedAt": timestamp}
                errors[symbol] = f"Symbol '{symbol}' not found in broker symbols"
                continue
            tick = mt5.symbol_info_tick(resolved)
            if tick is None:
                data[symbol] = {"bid": None, "ask": None, "last": None, "updatedAt": timestamp}
                errors[symbol] = f"No tick data for '{resolved}'"
            else:
                tick_time = datetime.fromtimestamp(tick.time, tz=timezone.utc).isoformat() if tick.time else timestamp
                data[symbol] = {
                    "bid": float(tick.bid),
                    "ask": float(tick.ask),
                    "last": float(getattr(tick, "last", 0.0) or 0.0),
                    "updatedAt": tick_time,
                }
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass

    return {"ok": True, "data": data, "errors": errors, "timestamp": timestamp}


# ---------------------------------------------------------------------------
# Candles  — GET /candles?symbol=XAUUSD&timeframe=M15&limit=100
# ---------------------------------------------------------------------------

def _rates_to_candles(rates) -> list[dict[str, Any]]:
    return [
        {
            "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc).isoformat(),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "tickVolume": float(r["tick_volume"]),
            "volume": float(r["tick_volume"]),
            "spread": int(r["spread"]) if "spread" in r.dtype.names else None,
            "realVolume": float(r["real_volume"]) if "real_volume" in r.dtype.names else 0,
        }
        for r in rates
    ]


@app.get("/candles")
def candles(
    symbol: str = Query(...),
    timeframe: str = Query("M15"),
    limit: int = Query(100, ge=1, le=5000),
    count: int | None = Query(None, ge=1, le=5000),
    x_api_key: str | None = Header(default=None),
):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import _load_mt5, _build_connection_kwargs, _normalize_timeframe, MetaTraderServiceError

    effective_count = count or limit

    try:
        tf_const = _normalize_timeframe(timeframe)
    except MetaTraderServiceError as exc:
        raise HTTPException(status_code=400, detail={"ok": False, "error": "INVALID_TIMEFRAME", "message": exc.message})

    try:
        mt5 = _load_mt5()
    except Exception as exc:
        return {"ok": False, "error": "MT5_NOT_INSTALLED", "symbol": symbol, "candles": [], "message": str(exc)}

    try:
        if not mt5.initialize(**_build_connection_kwargs(5000)):
            _, message = mt5.last_error()
            return {"ok": False, "error": "MT5_NOT_CONNECTED", "symbol": symbol, "candles": [],
                    "message": f"MetaTrader 5 terminal is not connected or not initialized: {message}"}

        requested = symbol.upper()
        resolved = _resolve_symbol(mt5, requested)
        if resolved is None:
            candidates = [requested] + _SYMBOL_ALIASES.get(requested, [])
            return {"ok": False, "error": "MT5_SYMBOL_NOT_FOUND", "symbol": symbol, "candles": [],
                    "message": f"Could not find {requested} or mapped broker equivalent in MT5 Market Watch.",
                    "details": {"requested": requested, "candidatesTried": candidates}}

        rates = mt5.copy_rates_from_pos(resolved, tf_const, 0, effective_count)
        if rates is None or len(rates) == 0:
            return {"ok": True, "symbol": symbol, "resolvedSymbol": resolved, "timeframe": timeframe,
                    "count": 0, "source": "mt5-python-bridge", "candles": [], "status": "NO_DATA",
                    "message": f"No {timeframe} history for {resolved}. Open the chart in MT5 to download history."}

        candle_list = _rates_to_candles(rates)
        return {
            "ok": True,
            "symbol": symbol,
            "resolvedSymbol": resolved,
            "timeframe": timeframe,
            "count": len(candle_list),
            "source": "mt5-python-bridge",
            "candles": candle_list,
        }
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Bulk candles
# ---------------------------------------------------------------------------

@app.get("/candles/bulk")
def candles_bulk(
    symbols: str = Query(...),
    timeframes: str = Query("W1,D1,H4,H1,M15,M5"),
    count: int = Query(300, ge=1, le=5000),
    x_api_key: str | None = Header(default=None),
):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import _load_mt5, _build_connection_kwargs, _normalize_timeframe, MetaTraderServiceError

    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    tf_list = [t.strip().upper() for t in timeframes.split(",") if t.strip()]
    if not symbol_list or not tf_list:
        raise HTTPException(status_code=400, detail={"ok": False, "error": "INVALID_PAYLOAD", "message": "symbols and timeframes required"})

    try:
        mt5 = _load_mt5()
    except Exception as exc:
        return {"ok": False, "error": "MT5_NOT_INSTALLED", "message": str(exc), "data": {}}

    tf_consts: dict[str, int] = {}
    for tf in tf_list:
        try:
            tf_consts[tf] = _normalize_timeframe(tf)
        except MetaTraderServiceError as exc:
            raise HTTPException(status_code=400, detail={"ok": False, "error": "INVALID_TIMEFRAME", "message": exc.message})

    data: dict[str, dict[str, Any]] = {}
    try:
        if not mt5.initialize(**_build_connection_kwargs(8000)):
            _, message = mt5.last_error()
            return {"ok": False, "error": "MT5_NOT_CONNECTED",
                    "message": f"MetaTrader 5 terminal is not connected or not initialized: {message}", "data": {}}

        for symbol in symbol_list:
            resolved = _resolve_symbol(mt5, symbol)
            per_symbol: dict[str, Any] = {}
            if resolved is None:
                for tf in tf_list:
                    per_symbol[tf] = {"ok": False, "error": "MT5_SYMBOL_NOT_FOUND", "candles": [],
                                      "message": f"Symbol '{symbol}' not found in MT5 Market Watch."}
                data[symbol] = per_symbol
                continue
            for tf in tf_list:
                rates = mt5.copy_rates_from_pos(resolved, tf_consts[tf], 0, count)
                if rates is None or len(rates) == 0:
                    per_symbol[tf] = {"ok": True, "candles": [], "count": 0, "status": "NO_DATA",
                                      "resolvedSymbol": resolved}
                else:
                    candle_list = _rates_to_candles(rates)
                    per_symbol[tf] = {"ok": True, "candles": candle_list, "count": len(candle_list),
                                      "resolvedSymbol": resolved}
            data[symbol] = per_symbol
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass

    return {"ok": True, "source": "mt5-python-bridge", "count": count,
            "timestamp": datetime.now(timezone.utc).isoformat(), "data": data}


# ---------------------------------------------------------------------------
# Symbols
# ---------------------------------------------------------------------------

@app.get("/symbols")
def symbols_route(x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key, required=False)
    from .services.metatrader_service import _load_mt5, _build_connection_kwargs

    try:
        mt5 = _load_mt5()
    except Exception as exc:
        return {"ok": False, "error": "MT5_NOT_INSTALLED", "message": str(exc), "symbols": []}

    try:
        if not mt5.initialize(**_build_connection_kwargs(5000)):
            _, message = mt5.last_error()
            return {"ok": False, "error": "MT5_NOT_CONNECTED", "message": str(message), "symbols": []}
        all_symbols = mt5.symbols_get() or []
        visible = [s.name for s in all_symbols if getattr(s, "visible", False)]
        return {"ok": True, "count": len(visible), "symbols": visible,
                "totalAvailable": len(all_symbols),
                "timestamp": datetime.now(timezone.utc).isoformat()}
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Connect / disconnect
# ---------------------------------------------------------------------------

@app.post("/connect")
def connect(payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    from .services.metatrader_service import connect as svc_connect, MetaTraderServiceError
    try:
        return svc_connect(payload)
    except MetaTraderServiceError as exc:
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "success": False,
            "status": exc.status,
            "error": {"code": exc.code, "message": exc.message, "details": exc.details},
        })


@app.post("/disconnect")
def disconnect_route(payload: dict[str, Any] = {}, x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    from .services.metatrader_service import disconnect as svc_disconnect
    return svc_disconnect(payload.get("connectionKey", ""))


# ---------------------------------------------------------------------------
# Order / close
# ---------------------------------------------------------------------------

@app.post("/order")
def place_order(_payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    if os.getenv("MT5_TRADING_ENABLED", "false").lower() != "true":
        raise HTTPException(status_code=403, detail={"ok": False, "error": "Trade execution disabled. Set MT5_TRADING_ENABLED=true to enable."})
    raise HTTPException(status_code=501, detail={"ok": False, "error": "Order placement not yet implemented."})


@app.post("/close")
def close_position(_payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    if os.getenv("MT5_TRADING_ENABLED", "false").lower() != "true":
        raise HTTPException(status_code=403, detail={"ok": False, "error": "Trade execution disabled. Set MT5_TRADING_ENABLED=true to enable."})
    raise HTTPException(status_code=501, detail={"ok": False, "error": "Position close not yet implemented."})


# ---------------------------------------------------------------------------
# Legacy v1 routes (Node.js backend compatibility)
# ---------------------------------------------------------------------------

from .routes.metatrader import router as _mt5_router, metatrader_router as _mt5_compat  # noqa: E402
from .routes.market import router as _market_router  # noqa: E402

app.include_router(_mt5_router)
app.include_router(_mt5_compat)
app.include_router(_market_router)
