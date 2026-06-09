#!/usr/bin/env python3

import json
import sys
from datetime import datetime, timedelta, timezone


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def fail(code, message, status="failed", details=None):
    emit(
        {
            "success": False,
            "status": status,
            "error": {
                "code": code,
                "message": message,
                "details": details,
            },
        }
    )
    sys.exit(0)


def map_error(message):
    normalized = (message or "").lower()
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
    if "initialize" in normalized or "terminal" in normalized or "module" in normalized:
        return "CONNECTION_UNAVAILABLE"
    return "FAILED_TO_CONNECT"


def format_timestamp(seconds):
    if not seconds:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        fail("INVALID_PAYLOAD", "MetaTrader bridge received an invalid payload.")

    version = str(payload.get("version", "")).lower()
    if version == "mt4":
        fail(
            "CONNECTION_UNAVAILABLE",
            "MT4 local bridge is unavailable in this environment. Configure a MetaTrader bridge that supports MT4.",
            status="disconnected",
        )

    if version != "mt5":
        fail("UNSUPPORTED_VERSION", "Only MT4 or MT5 accounts can be connected.")

    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception:
        fail(
            "CONNECTION_UNAVAILABLE",
            "MetaTrader 5 login is unavailable in this runtime. Use a supported Windows MetaTrader bridge or configure METATRADER_PYTHON_BIN to a Python environment where MetaTrader5 is installed alongside the MetaTrader 5 terminal.",
            status="disconnected",
        )

    login = payload.get("login")
    password = payload.get("password")
    server = payload.get("server")
    timeout_ms = int(payload.get("timeoutMs", 15000))
    history_days = int(payload.get("historyDays", 90))
    history_limit = int(payload.get("historyLimit", 100))

    if not login or not password or not server:
        fail("INVALID_PAYLOAD", "Login, password, and server are required.")

    initialized = mt5.initialize(timeout=timeout_ms)
    if not initialized:
        code, message = mt5.last_error()
        fail(map_error(message), "MT5 connection unavailable.", status="disconnected", details={"mt5Code": code, "mt5Message": message})

    try:
        authorized = mt5.login(login=int(login), password=str(password), server=str(server), timeout=timeout_ms)
        if not authorized:
            code, message = mt5.last_error()
            error_code = map_error(message)
            user_message = {
                "INVALID_LOGIN": "The account login number is invalid.",
                "WRONG_PASSWORD": "The password or investor password is incorrect.",
                "WRONG_SERVER": "The broker/server name is incorrect.",
                "CONNECTION_TIMEOUT": "The MetaTrader connection timed out.",
                "UNSUPPORTED_SERVER": "This broker/server is not supported by the active MetaTrader bridge.",
                "CONNECTION_UNAVAILABLE": "The MT4/MT5 connection is currently unavailable.",
            }.get(error_code, "Failed to connect to the MetaTrader account.")
            fail(error_code, user_message, details={"mt5Code": code, "mt5Message": message})

        account_info = mt5.account_info()
        if account_info is None:
            code, message = mt5.last_error()
            fail(map_error(message), "Connected, but failed to fetch account details.", details={"mt5Code": code, "mt5Message": message})

        terminal_info = mt5.terminal_info()
        positions = mt5.positions_get() or []
        now_utc = datetime.now(timezone.utc)
        history_from = now_utc - timedelta(days=max(history_days, 1))
        history_deals = mt5.history_deals_get(history_from, now_utc) or []

        position_items = []
        for position in positions[:10]:
          position_items.append(
              {
                  "ticket": str(position.ticket),
                  "symbol": position.symbol,
                  "type": "buy" if int(position.type) == 0 else "sell",
                  "volume": float(position.volume),
                  "profit": float(position.profit),
                  "openPrice": float(position.price_open),
                  "currentPrice": float(position.price_current),
                  "openedAt": format_timestamp(position.time),
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
                    "time": format_timestamp(deal.time),
                    "comment": getattr(deal, "comment", None),
                }
            )

        emit(
            {
                "success": True,
                "status": "connected",
                "account": {
                    "login": str(account_info.login),
                    "server": account_info.server,
                    "broker": getattr(account_info, "company", None) or getattr(terminal_info, "company", None) or server,
                    "name": getattr(account_info, "name", None) or f"MT5 {account_info.login}",
                    "balance": float(account_info.balance),
                    "equity": float(account_info.equity),
                    "currency": account_info.currency,
                    "leverage": int(account_info.leverage),
                },
                "positions": position_items,
                "history": history_items,
            }
        )
    except Exception as exc:
        fail(map_error(str(exc)), "Failed to connect to the MetaTrader account.", details={"exception": str(exc)})
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


if __name__ == "__main__":
    main()
