#!/usr/bin/env python3

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import uvicorn


ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"

load_dotenv(ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env", override=False)

sys.path.insert(0, str(BACKEND_DIR))

from app import app  # noqa: E402


def main():
    host = os.getenv("MT5_API_HOST", "127.0.0.1")
    port = int(os.getenv("MT5_API_PORT", "8001"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
