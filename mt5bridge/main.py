#!/usr/bin/env python3
"""
Entry point for the Alphamentals MT5 Bridge.

Usage (from project root):
    mt5bridge\\.venv\\Scripts\\python.exe -m uvicorn mt5bridge.app:app --host 127.0.0.1 --port 8001

Or from within the mt5bridge directory:
    ..\\venv\\Scripts\\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root, then mt5bridge/.env (override)
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

import uvicorn  # noqa: E402


def main():
    host = os.getenv("MT5_API_HOST", "127.0.0.1")
    port = int(os.getenv("MT5_API_PORT", "8001"))
    log_level = os.getenv("LOG_LEVEL", "info").lower()

    print(f"[mt5-bridge] starting on {host}:{port}")
    uvicorn.run(
        "mt5bridge.app:app",
        host=host,
        port=port,
        log_level=log_level,
        reload=False,
    )


if __name__ == "__main__":
    main()
