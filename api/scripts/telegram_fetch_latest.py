#!/usr/bin/env python3
"""
Telegram limit-signal fetcher — uses Telethon to read the latest messages
from a configured Telegram group/channel and filter XAUUSD/GOLD limit orders.

Commands:
  fetch-latest   Fetch latest 10 messages and return limit signals  (default)
  test           Test connection and resolve the target chat
  doctor         Check the Python environment and credentials

All output is a single JSON line written to stdout.
"""

import asyncio
import json
import os
import re
import sys


# ── .env loader (best-effort) ────────────────────────────────────────────────

def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        p = os.path.join(d, '.env')
        if os.path.isfile(p):
            load_dotenv(p)
            return
        parent = os.path.dirname(d)
        if parent == d:
            return
        d = parent


_load_dotenv()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _emit(data: dict) -> None:
    print(json.dumps(data), flush=True)


def _get_raw_config():
    api_id_str = os.environ.get('TELEGRAM_API_ID', '').strip()
    api_hash   = os.environ.get('TELEGRAM_API_HASH', '').strip()
    session    = (
        os.environ.get('TELEGRAM_SESSION', '').strip()
        or os.environ.get('TELEGRAM_SESSION_STRING', '').strip()
    )
    target_chat = (
        os.environ.get('TELEGRAM_TARGET_CHAT', '').strip()
        or os.environ.get('TELEGRAM_CHAT_ID', '').strip()
        or os.environ.get('TELEGRAM_CHANNEL_ID', '').strip()
        or os.environ.get('TELEGRAM_GROUP_ID', '').strip()
    )
    return api_id_str, api_hash, session, target_chat


def _validate_and_parse():
    """Validate env vars and return parsed values, or emit error + exit."""
    api_id_str, api_hash, session, target_chat = _get_raw_config()

    if not api_id_str or not api_hash:
        _emit({
            'ok': False,
            'phase': 'TELEGRAM_CREDENTIALS_MISSING',
            'message': 'TELEGRAM_API_ID and TELEGRAM_API_HASH are required.',
        })
        sys.exit(0)

    if not session:
        _emit({
            'ok': False,
            'phase': 'TELEGRAM_SESSION_MISSING',
            'message': 'TELEGRAM_SESSION is required for user-account Telegram group access.',
        })
        sys.exit(0)

    if not target_chat:
        _emit({
            'ok': False,
            'phase': 'TELEGRAM_TARGET_CHAT_MISSING',
            'message': 'TELEGRAM_TARGET_CHAT is required.',
        })
        sys.exit(0)

    try:
        api_id = int(api_id_str)
    except ValueError:
        _emit({
            'ok': False,
            'phase': 'TELEGRAM_CREDENTIALS_MISSING',
            'message': 'TELEGRAM_API_ID must be a numeric value.',
        })
        sys.exit(0)

    return api_id, api_hash, session, target_chat


# ── Limit-signal detection & parsing ─────────────────────────────────────────

_LIMIT_RE = re.compile(
    r'\b(?:XAUUSD|XAU/USD|GOLD)\s+(?:BUY|SELL)\s+LIMIT\b'
    r'|\b(?:BUY|SELL)\s+LIMIT\s+(?:XAUUSD|XAU/USD|GOLD)\b',
    re.IGNORECASE,
)


def _is_limit_signal(text: str) -> bool:
    return bool(_LIMIT_RE.search(text))


def _parse_side(text: str) -> str:
    return 'SELL' if re.search(r'\bSELL\b', text, re.IGNORECASE) else 'BUY'


def _parse_number(text: str, labels: list) -> 'float | None':
    for label in labels:
        m = re.search(
            rf'\b{re.escape(label)}\b\s*[:\s@]*\s*(\d+(?:[.,]\d+)?)',
            text, re.IGNORECASE,
        )
        if m:
            try:
                return float(m.group(1).replace(',', '.'))
            except ValueError:
                pass
    return None


def _parse_tps(text: str) -> list:
    return [
        float(m.group(1).replace(',', '.'))
        for m in re.finditer(
            r'\bTP\s*\d*\s*[:\s@]*\s*(\d+(?:[.,]\d+)?)', text, re.IGNORECASE
        )
    ]


def _parse_signal(msg_id, chat_id: str, text: str, date: str) -> dict:
    side  = _parse_side(text)
    entry = _parse_number(text, ['ENTRY', 'ENTER', 'PRICE', '@'])
    sl    = _parse_number(text, ['SL', 'STOP LOSS', 'STOP'])
    tps   = _parse_tps(text)
    if not tps:
        tp = _parse_number(text, ['TP', 'TAKE PROFIT', 'TARGET'])
        if tp is not None:
            tps = [tp]
    return {
        'id':          f'tg-{msg_id}',
        'messageId':   str(msg_id),
        'chatId':      chat_id,
        'rawText':     text,
        'symbol':      'XAUUSD',
        'side':        side,
        'orderType':   'LIMIT',
        'entry':       entry,
        'stopLoss':    sl,
        'takeProfits': tps,
        'sentAt':      date,
        'source':      'telegram',
    }


# ── Telethon session helper ───────────────────────────────────────────────────

def _make_session(session_str: str):
    """Return a StringSession for long strings, or treat short values as file paths."""
    try:
        from telethon.sessions import StringSession  # type: ignore
    except ImportError:
        return session_str  # will fail later with a clear message
    return StringSession(session_str) if len(session_str) > 50 else session_str


# ── Commands ──────────────────────────────────────────────────────────────────

async def _cmd_fetch_latest(
    api_id: int, api_hash: str, session: str, target_chat: str, limit: int = 10
) -> None:
    try:
        from telethon import TelegramClient  # type: ignore
    except ImportError:
        _emit({
            'ok': False,
            'phase': 'TELETHON_NOT_INSTALLED',
            'message': 'Telethon is not installed. Run: py -3.11 -m pip install telethon',
        })
        return

    client = TelegramClient(_make_session(session), api_id, api_hash)
    try:
        await client.connect()

        if not await client.is_user_authorized():
            _emit({
                'ok': False,
                'phase': 'TELEGRAM_SESSION_INVALID',
                'message': 'Session is not authorized. Re-generate TELEGRAM_SESSION.',
            })
            return

        try:
            entity = await client.get_entity(
                int(target_chat) if target_chat.lstrip('-').isdigit() else target_chat
            )
        except Exception as exc:
            _emit({
                'ok': False,
                'phase': 'TELEGRAM_CHAT_NOT_FOUND',
                'message': f'Cannot resolve target chat "{target_chat}": {exc}',
            })
            return

        chat_id       = str(entity.id)
        messages_raw  = []
        limit_signals = []

        async for msg in client.iter_messages(entity, limit=limit):
            if not msg.text:
                continue
            text    = msg.text
            sent_at = msg.date.isoformat() if msg.date else ''
            messages_raw.append({'messageId': str(msg.id), 'text': text[:500], 'sentAt': sent_at})
            if _is_limit_signal(text):
                limit_signals.append(_parse_signal(msg.id, chat_id, text, sent_at))

        _emit({
            'ok':                True,
            'phase':             'CONNECTED',
            'chatId':            chat_id,
            'messagesFetched':   len(messages_raw),
            'messages':          messages_raw,
            'limitSignals':      limit_signals,
            'limitSignalsFound': len(limit_signals),
        })

    except Exception as exc:
        _emit({'ok': False, 'phase': 'TELEGRAM_CONNECT_FAILED', 'message': str(exc)})
    finally:
        await client.disconnect()


async def _cmd_test(
    api_id: int, api_hash: str, session: str, target_chat: str
) -> None:
    try:
        from telethon import TelegramClient  # type: ignore
    except ImportError:
        _emit({
            'ok': False,
            'phase': 'TELETHON_NOT_INSTALLED',
            'message': 'Telethon is not installed. Run: py -3.11 -m pip install telethon',
        })
        return

    client = TelegramClient(_make_session(session), api_id, api_hash)
    try:
        await client.connect()

        if not await client.is_user_authorized():
            _emit({
                'ok': False,
                'phase': 'TELEGRAM_SESSION_INVALID',
                'message': 'Session is not authorized.',
            })
            return

        me = await client.get_me()

        try:
            entity = await client.get_entity(
                int(target_chat) if target_chat.lstrip('-').isdigit() else target_chat
            )
            chat_title = getattr(entity, 'title', None) or getattr(entity, 'username', None)
            chat_id    = str(entity.id)
            _emit({
                'ok':          True,
                'phase':       'CONNECTED',
                'authorized':  True,
                'chatResolved': True,
                'chatId':      chat_id,
                'chatTitle':   chat_title,
                'username':    me.username if me else None,
            })
        except Exception as exc:
            _emit({
                'ok':          True,
                'phase':       'CONNECTED',
                'authorized':  True,
                'chatResolved': False,
                'chatError':   str(exc),
                'username':    me.username if me else None,
            })

    except Exception as exc:
        _emit({'ok': False, 'phase': 'TELEGRAM_CONNECT_FAILED', 'message': str(exc)})
    finally:
        await client.disconnect()


def _cmd_doctor() -> None:
    api_id_str, api_hash, session, target_chat = _get_raw_config()

    try:
        import telethon  # type: ignore
        telethon_version  = telethon.__version__
        telethon_installed = True
    except ImportError:
        telethon_version  = None
        telethon_installed = False

    _emit({
        'ok':                     True,
        'python_version':         sys.version,
        'telethon_installed':     telethon_installed,
        'telethon_version':       telethon_version,
        'api_id_configured':      bool(api_id_str),
        'api_hash_configured':    bool(api_hash),
        'session_configured':     bool(session),
        'target_chat_configured': bool(target_chat),
        'working_directory':      os.getcwd(),
    })


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'fetch-latest'

    if cmd == 'doctor':
        _cmd_doctor()
        return

    api_id, api_hash, session, target_chat = _validate_and_parse()

    if cmd == 'test':
        asyncio.run(_cmd_test(api_id, api_hash, session, target_chat))
    else:
        asyncio.run(_cmd_fetch_latest(api_id, api_hash, session, target_chat, limit=10))


if __name__ == '__main__':
    main()
