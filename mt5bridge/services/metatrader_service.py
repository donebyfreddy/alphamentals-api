from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar


class MetaTraderServiceError(Exception):
    def __init__(self, code: str, message: str, status: str = "failed", details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


T = TypeVar("T")

_STORE: dict[str, dict[str, Any]] = {}
_ACTIVE_CONNECTION_KEY: str | None = None


def _map_error(message: str | None) -> str:
    normalized = (message or "").lower()
    if "ipc" in normalized or "terminal" in normalized or "connection" in normalized:
        return "TERMINAL_NOT_RUNNING"
    if "module" in normalized or "dll" in normalized:
        return "TERMINAL_NOT_INSTALLED"
    if "timeout" in normalized:
        return "CONNECTION_TIMEOUT"
    if "unsupported" in normalized:
        return "UNSUPPORTED_SERVER"
    if "password" in normalized or "authorization failed" in normalized:
        return "WRONG_PASSWORD"
    if "server" in normalized and ("invalid" in normalized or "not found" in normalized):
        return "WRONG_SERVER"
    if "login" in normalized or "account" in normalized:
        return "INVALID_LOGIN"
    if "initialize" in normalized:
        return "CONNECTION_UNAVAILABLE"
    return "FAILED_TO_CONNECT"


def _user_message(error_code: str) -> str:
    return {
        "INVALID_LOGIN": "The account login number is invalid.",
        "WRONG_PASSWORD": "The investor password is incorrect.",
        "WRONG_SERVER": "The broker/server name is incorrect.",
        "CONNECTION_TIMEOUT": "The MetaTrader connection timed out.",
        "UNSUPPORTED_SERVER": "This broker/server is not supported by the active MetaTrader bridge.",
        "CONNECTION_UNAVAILABLE": "The MT5 connection is currently unavailable.",
        "TERMINAL_NOT_INSTALLED": "MetaTrader 5 terminal is not installed or the configured terminal path is invalid.",
        "TERMINAL_NOT_RUNNING": "MetaTrader 5 terminal is not running or cannot be reached from the Python bridge.",
        "READ_ONLY_REQUIRED": "This bridge only accepts the investor read-only password.",
    }.get(error_code, "Failed to connect to the MetaTrader account.")


def _load_mt5():
    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on host runtime
        raise MetaTraderServiceError(
            "TERMINAL_NOT_INSTALLED",
            "MetaTrader 5 Python package is unavailable in this runtime. Install the MetaTrader5 package in a supported Windows environment with the MetaTrader 5 terminal.",
            status="disconnected",
            details=str(exc),
        ) from exc
    return mt5


def _format_timestamp(seconds: int | float | None):
    if not seconds:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def _connection_key(version: str, server: str, login: str) -> str:
    return f"{version}:{server.strip().lower()}:{login.strip()}"


def _terminal_path() -> str | None:
    value = os.getenv("MT5_TERMINAL_PATH", "").strip()
    if not value:
        return None
    return value


def _build_connection_kwargs(timeout_ms: int) -> dict[str, Any]:
    terminal_path = _terminal_path()
    if terminal_path:
        if not Path(terminal_path).exists():
            raise MetaTraderServiceError(
                "TERMINAL_NOT_INSTALLED",
                "MetaTrader 5 terminal path does not exist. Check MT5_TERMINAL_PATH.",
                status="disconnected",
                details={"path": terminal_path},
            )
        return {"path": terminal_path, "timeout": timeout_ms}
    return {"timeout": timeout_ms}


def _resolve_stored_credentials(connection_key: str | None = None) -> dict[str, Any]:
    global _ACTIVE_CONNECTION_KEY

    resolved_key = connection_key or _ACTIVE_CONNECTION_KEY
    if not resolved_key:
        raise MetaTraderServiceError(
            "CONNECTION_UNAVAILABLE",
            "No MT5 session is active. Connect first.",
            status="disconnected",
        )

    stored = _STORE.get(resolved_key)
    if not stored:
        raise MetaTraderServiceError(
            "CONNECTION_UNAVAILABLE",
            "MetaTrader connection unavailable. Please reconnect the account credentials.",
            status="disconnected",
        )

    _ACTIVE_CONNECTION_KEY = resolved_key
    return stored


def _env_default_credentials() -> dict[str, Any]:
    login = os.getenv("MT5_LOGIN", "").strip()
    password = os.getenv("MT5_PASSWORD", "").strip()
    server = os.getenv("MT5_SERVER", "").strip()

    if not login:
        raise MetaTraderServiceError("INVALID_PAYLOAD", "MT5 login is missing.")
    if not password:
        raise MetaTraderServiceError("INVALID_PAYLOAD", "MT5 investor password is missing.")
    if not server:
        raise MetaTraderServiceError("INVALID_PAYLOAD", "MT5 server name is missing.")

    return {
        "version": "mt5",
        "login": login,
        "password": password,
        "server": server,
        "accountType": os.getenv("MT5_ACCOUNT_TYPE", "demo"),
        "passwordType": os.getenv("MT5_PASSWORD_TYPE", "investor"),
    }


def _with_session(credentials: dict[str, Any], callback: Callable[[Any], T], timeout_ms: int = 15000) -> T:
    if str(credentials.get("version", "")).lower() != "mt5":
        raise MetaTraderServiceError(
            "UNSUPPORTED_VERSION",
            "This bridge currently supports MT5 only.",
            status="disconnected",
        )

    password_type = str(credentials.get("passwordType", "investor")).lower()
    if password_type != "investor":
        raise MetaTraderServiceError(
            "READ_ONLY_REQUIRED",
            "This bridge only accepts the investor read-only password.",
            details={"passwordType": password_type},
        )

    mt5 = _load_mt5()

    initialized = mt5.initialize(**_build_connection_kwargs(timeout_ms))
    if not initialized:
        code, message = mt5.last_error()
        error_code = _map_error(message)
        raise MetaTraderServiceError(
            error_code,
            _user_message(error_code),
            status="disconnected" if error_code in {"TERMINAL_NOT_RUNNING", "TERMINAL_NOT_INSTALLED"} else "failed",
            details={"mt5Code": code, "mt5Message": message},
        )

    try:
        authorized = mt5.login(
            login=int(str(credentials["login"])),
            password=str(credentials["password"]),
            server=str(credentials["server"]),
            timeout=timeout_ms,
        )
        if not authorized:
            code, message = mt5.last_error()
            error_code = _map_error(message)
            raise MetaTraderServiceError(
                error_code,
                _user_message(error_code),
                status="disconnected" if error_code in {"TERMINAL_NOT_RUNNING", "TERMINAL_NOT_INSTALLED"} else "failed",
                details={"mt5Code": code, "mt5Message": message},
            )

        return callback(mt5)
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


def _read_account_bundle(credentials: dict[str, Any], history_days: int = 90, history_limit: int = 100) -> dict[str, Any]:
    def loader(mt5: Any):
        account_info = mt5.account_info()
        if account_info is None:
            code, message = mt5.last_error()
            error_code = _map_error(message)
            raise MetaTraderServiceError(
                error_code,
                "Connected, but failed to fetch account details.",
                details={"mt5Code": code, "mt5Message": message},
            )

        terminal_info = mt5.terminal_info()
        positions = mt5.positions_get() or []
        now_utc = datetime.now(timezone.utc)
        history_from = now_utc - timedelta(days=max(history_days, 1))
        history_deals = mt5.history_deals_get(history_from, now_utc) or []

        position_items = []
        for position in positions[:50]:
            position_items.append(
                {
                    "ticket": str(position.ticket),
                    "symbol": position.symbol,
                    "type": "buy" if int(position.type) == 0 else "sell",
                    "volume": float(position.volume),
                    "profit": float(position.profit),
                    "openPrice": float(position.price_open),
                    "currentPrice": float(position.price_current),
                    "openedAt": _format_timestamp(position.time),
                }
            )

        history_items = []
        sorted_deals = sorted(history_deals, key=lambda deal: deal.time, reverse=True)
        for deal in sorted_deals[:history_limit]:
            entry_type = getattr(deal, "entry", None)
            history_items.append(
                {
                    "ticket": str(deal.ticket),
                    "order": str(getattr(deal, "order", deal.ticket)),
                    "positionId": str(getattr(deal, "position_id", "")),
                    "symbol": deal.symbol,
                    "type": "buy" if int(deal.type) == 0 else "sell",
                    "entryType": int(entry_type) if entry_type is not None else None,
                    "volume": float(deal.volume),
                    "price": float(deal.price),
                    "profit": float(deal.profit),
                    "commission": float(getattr(deal, "commission", 0.0)),
                    "swap": float(getattr(deal, "swap", 0.0)),
                    "time": _format_timestamp(deal.time),
                    "comment": getattr(deal, "comment", None),
                }
            )

        return {
            "success": True,
            "status": "connected",
            "account": {
                "login": str(account_info.login),
                "server": account_info.server,
                "broker": getattr(account_info, "company", None) or getattr(terminal_info, "company", None) or credentials["server"],
                "name": getattr(account_info, "name", None) or f"MT5 {account_info.login}",
                "balance": float(account_info.balance),
                "equity": float(account_info.equity),
                "currency": account_info.currency,
                "leverage": int(account_info.leverage),
                "tradeAllowed": bool(getattr(account_info, "trade_allowed", False)),
                "isInvestor": True,
            },
            "positions": position_items,
            "history": history_items,
        }

    return _with_session(credentials, loader)


def _normalize_timeframe(timeframe: str) -> int:
    normalized = timeframe.strip().upper()
    mt5 = _load_mt5()
    mapping = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }
    if normalized not in mapping:
        raise MetaTraderServiceError("INVALID_PAYLOAD", f"Unsupported timeframe '{timeframe}'.")
    return mapping[normalized]


def connect(credentials: dict[str, Any]):
    global _ACTIVE_CONNECTION_KEY

    result = _read_account_bundle(credentials)
    connection_key = _connection_key(credentials["version"], credentials["server"], credentials["login"])
    _STORE[connection_key] = dict(credentials)
    _ACTIVE_CONNECTION_KEY = connection_key
    return {**result, "connectionKey": connection_key}


def sync(connection_key: str):
    stored = _resolve_stored_credentials(connection_key)
    return {**_read_account_bundle(stored), "connectionKey": connection_key}


def disconnect(connection_key: str):
    global _ACTIVE_CONNECTION_KEY

    _STORE.pop(connection_key, None)
    if _ACTIVE_CONNECTION_KEY == connection_key:
        _ACTIVE_CONNECTION_KEY = next(iter(_STORE.keys()), None)
    return {"success": True, "status": "disconnected"}


def health():
    try:
        _load_mt5()
    except MetaTraderServiceError as error:
        return {"healthy": False, "message": error.message, "code": error.code}

    try:
        mt5 = _load_mt5()
        initialized = mt5.initialize(**_build_connection_kwargs(5000))
        if not initialized:
            code, message = mt5.last_error()
            error_code = _map_error(message)
            return {
                "healthy": False,
                "message": _user_message(error_code),
                "code": error_code,
                "details": {"mt5Code": code, "mt5Message": message},
            }
        mt5.shutdown()
    except MetaTraderServiceError as error:
        return {"healthy": False, "message": error.message, "code": error.code, "details": error.details}
    except Exception as error:
        return {"healthy": False, "message": str(error), "code": "FAILED_TO_CONNECT"}

    return {"healthy": True, "message": "MT5 bridge is running and the MetaTrader 5 package is available."}


def test_connection(credentials: dict[str, Any] | None = None):
    resolved = credentials or _env_default_credentials()
    result = connect(resolved)
    return {
        "success": True,
        "message": "Successfully connected to MetaTrader 5 with investor read-only access.",
        "connectionKey": result["connectionKey"],
        "account": result["account"],
    }


def get_account(connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)
    return _read_account_bundle(stored)["account"]


def get_positions(connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)
    return _read_account_bundle(stored)["positions"]


def get_history(connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)
    return _read_account_bundle(stored)["history"]


def get_symbols(connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)

    def loader(mt5: Any):
        symbols = mt5.symbols_get() or []
        return [
            {
                "name": symbol.name,
                "description": getattr(symbol, "description", None),
                "digits": getattr(symbol, "digits", None),
                "trade_mode": getattr(symbol, "trade_mode", None),
            }
            for symbol in symbols
        ]

    return _with_session(stored, loader)


def get_tick(symbol: str, connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)

    def loader(mt5: Any):
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MetaTraderServiceError("FAILED_TO_CONNECT", f"Symbol '{symbol}' not found or unavailable.")
        return {
            "symbol": symbol,
            "bid": float(tick.bid),
            "ask": float(tick.ask),
            "last": float(getattr(tick, "last", 0.0) or 0.0),
            "time": _format_timestamp(getattr(tick, "time", None)),
        }

    return _with_session(stored, loader)


def get_historical_data(symbol: str, timeframe: str, start_date: str, end_date: str, connection_key: str | None = None):
    stored = _resolve_stored_credentials(connection_key)

    def loader(mt5: Any):
        mt5.symbol_select(symbol, True)
        rates = mt5.copy_rates_range(
            symbol,
            _normalize_timeframe(timeframe),
            datetime.fromisoformat(start_date.replace("Z", "+00:00")),
            datetime.fromisoformat(end_date.replace("Z", "+00:00")),
        )
        if rates is None:
            raise MetaTraderServiceError("FAILED_TO_CONNECT", f"Historical data unavailable for '{symbol}'.")
        return [
            {
                "time": _format_timestamp(int(rate["time"])),
                "open": float(rate["open"]),
                "high": float(rate["high"]),
                "low": float(rate["low"]),
                "close": float(rate["close"]),
                "volume": float(rate["tick_volume"]),
            }
            for rate in rates
        ]

    return _with_session(stored, loader)
