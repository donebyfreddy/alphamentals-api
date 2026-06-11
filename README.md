# Alphamentals API

Full backend API server for the Alphamentals trading dashboard.
Runs on a Windows VPS with PM2, receiving live data directly from the MetaTrader 5 EA.

```
MetaTrader 5 EA (TradeBridgeEA.mq5)
  -> POST http://127.0.0.1:3001/ea/heartbeat
  -> POST http://127.0.0.1:3001/ea/tick
Node API on port 3001  ← this repo
  -> public API endpoints return latest MT5 data
Frontend dashboard (Cloudflare Pages / Vercel)
  <- NEXT_PUBLIC_API_BASE_URL=http://217.71.203.77:3001
```

## MetaTrader 5 requirements

- MetaTrader 5 must be open on the VPS.
- `TradeBridgeEA.mq5` must be compiled and attached to a chart.
- **Algo Trading** must be enabled (green button in the MT5 toolbar).
- In MT5: `Tools → Options → Expert Advisors → Allow WebRequest for listed URL`:

```
http://127.0.0.1:3001
```

The EA posts heartbeats to `http://127.0.0.1:3001/ea/heartbeat` and tick data to `http://127.0.0.1:3001/ea/tick`.

## Windows VPS deployment

### 1. Prerequisites

- Node.js 20+ (`winget install OpenJS.NodeJS.LTS`)
- PM2 (`npm install -g pm2`)
- Git

### 2. Clone and install

```powershell
git clone <repo-url> C:\alphamentals-api
cd C:\alphamentals-api
npm install
npx playwright install chromium
```

### 3. Configure environment

```powershell
copy .env.example .env
notepad .env
```

Minimum required values:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
CORS_ORIGINS=https://alphamentals-dashboard.pages.dev,https://alphamentals-dashboard.vercel.app,http://localhost:3000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
MYFXBOOK_EMAIL=
MYFXBOOK_PASSWORD=
MYFXBOOK_ENABLED=true
SCRAPING_ENABLED=true
PLAYWRIGHT_HEADLESS=true
NEWS_ENABLED=true
FUNDAMENTALS_ENABLED=true
CACHE_TTL_MINUTES=15
NEWS_CACHE_TTL_MINUTES=10
CALENDAR_CACHE_TTL_MINUTES=15
FUNDAMENTALS_CACHE_TTL_MINUTES=30
TIMEZONE=Europe/Madrid
```

### 4. Build and start

```powershell
npm run build
npm start
```

Or with the helper script:

```powershell
.\start.ps1
```

This builds the TypeScript API and starts `alphamentals-api` via PM2.

### 5. Verify locally

```powershell
curl.exe http://localhost:3001/health
curl.exe http://localhost:3001/api/health
curl.exe http://localhost:3001/api/sources/status
curl.exe http://localhost:3001/api/economic-calendar
curl.exe http://localhost:3001/api/news
curl.exe http://localhost:3001/api/fundamentals
curl.exe http://localhost:3001/ea/status
curl.exe "http://localhost:3001/api/mt5/status"
curl.exe "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD,EURUSD"
```

### 6. Verify from external network

```powershell
curl.exe http://217.71.203.77:3001/health
curl.exe "http://217.71.203.77:3001/api/market-data/quotes?symbols=XAUUSD"
```

### 7. Windows Firewall — open port 3001

Run in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Alphamentals API" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

## PM2 commands

```powershell
pm2 status
pm2 logs alphamentals-api
pm2 restart alphamentals-api
pm2 stop alphamentals-api
pm2 delete alphamentals-api
```

Or via npm scripts:

```powershell
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
```

## Market intelligence backend

Extra packages used by calendar/news/fundamentals:

```powershell
npm install playwright rss-parser zod node-cron dotenv
npx playwright install chromium
```

Manual refresh and status:

```powershell
curl.exe -X POST http://localhost:3001/api/refresh
curl.exe http://localhost:3001/api/sources/status
```

Logs:

```powershell
pm2 logs alphamentals-api
npm run pm2:logs
```

## EA endpoints

| Route | Method | Description |
|---|---|---|
| `/ea/heartbeat` | POST | Receives account snapshot from MT5 EA |
| `/ea/tick` | POST | Receives latest symbol price from MT5 EA |
| `/ea/status` | GET | EA connection status (based on last heartbeat age) |

### Heartbeat payload

```json
{
  "accountId": "10011220978-MetaQuotes-Demo",
  "account": {
    "login": "10011220978",
    "server": "MetaQuotes-Demo",
    "broker": "MetaQuotes Ltd.",
    "name": "Federico Mencuccini",
    "balance": 10000,
    "equity": 10000
  }
}
```

### Tick payload

```json
{
  "symbol": "XAUUSD",
  "bid": 2310.12,
  "ask": 2310.45,
  "price": 2310.285,
  "timestamp": "2026-06-10T08:48:22Z"
}
```

## API routes

| Route | Description |
|---|---|
| `GET /health` | Health check (public) |
| `GET /api/health` | Health check with service info |
| `GET /api/ping` | Liveness probe |
| `GET /api/mt5/status` | EA connection status |
| `GET /ea/status` | EA connection status (direct) |
| `GET /api/market-data/quotes?symbols=XAUUSD,EURUSD` | Live quotes from EA tick store |
| `GET /api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=200` | Candles |
| `GET /api/trades/recent` | Recent trades |
| `GET /api/journal/...` | Trade journal |
| `GET /api/analytics/...` | Analytics |
| `GET /api/accounts` | Trading accounts |
| `GET /api/economic-calendar` | Economic calendar |
| `GET /api/news` | Normalized news feed |
| `GET /api/fundamentals` | AI fundamental analysis |
| `GET /api/sources/status` | Real source health |
| `POST /api/refresh` | Force refresh calendar/news/fundamentals |

### Symbol formats accepted

| Input | Normalized |
|---|---|
| `XAU/USD` | `XAUUSD` |
| `XAUUSD` | `XAUUSD` |
| `EUR/USD` | `EURUSD` |
| `WTI` | `USOIL` |
| `DXY` | `DXY` |

### Timeframe formats accepted

| Input | Internal |
|---|---|
| `1m` | `M1` |
| `5m` | `M5` |
| `15m` | `M15` |
| `30m` | `M30` |
| `1h` | `H1` |
| `4h` | `H4` |
| `1d` | `D1` |

## Frontend configuration

```env
NEXT_PUBLIC_API_BASE_URL=http://217.71.203.77:3001
```

All `/api/*` requests from the dashboard go directly to this server.

## Development

```powershell
npm run dev:api      # run with tsx watch (hot-reload)
npm run build        # compile TypeScript -> dist-api/
npm run build:api    # compile TypeScript -> dist-api/
npm start            # run compiled output
```
