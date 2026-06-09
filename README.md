# Alphamentals API

Full backend API server for the Alphamentals trading dashboard.
Runs on a Windows VPS with PM2, serving all dashboard routes and proxying data from the MT5 bridge.

```
Frontend dashboard (Cloudflare Pages / Vercel)
  ↓  NEXT_PUBLIC_API_BASE_URL=http://217.71.203.77:3001
Windows VPS Backend API  ← this repo
  ↓  MT5_BRIDGE_URL=http://127.0.0.1:8001
Python MT5 Bridge (port 8001)
  ↓
MetaTrader 5
```

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
MT5_BRIDGE_URL=http://127.0.0.1:8001
MT5_BRIDGE_API_KEY=your-secret-key
CORS_ORIGINS=https://alphamentals-dashboard.pages.dev,https://alphamentals-dashboard.vercel.app,http://localhost:3000
```

### 4. Build

```powershell
npm run build:api
```

Output is written to `dist-api/backend/server/index.js`.

### 5. Start with PM2

```powershell
npm run pm2:start
pm2 save
pm2 startup
```

### 6. Verify locally

```powershell
curl http://localhost:3001/health
curl "http://localhost:3001/api/health"
curl "http://localhost:3001/api/ping"
curl "http://localhost:3001/api/mt5/status"
curl "http://localhost:3001/api/market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD"
curl "http://localhost:3001/api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=100"
```

### 7. Verify from external network

```powershell
curl http://217.71.203.77:3001/health
curl "http://217.71.203.77:3001/api/market-data/quotes?symbols=XAUUSD"
curl "http://217.71.203.77:3001/api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=100"
```

### 8. Windows Firewall — open port 3001

Run in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Alphamentals API" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

Or via the Windows Defender Firewall GUI:

1. Open **Windows Defender Firewall with Advanced Security**
2. **Inbound Rules → New Rule → Port**
3. TCP, specific local port: `3001`
4. Allow the connection
5. Apply to Domain, Private, Public
6. Name: `Alphamentals API`

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

## API routes

| Route | Description |
|---|---|
| `GET /health` | Health check (public) |
| `GET /api/health` | Health check with service info |
| `GET /api/ping` | Liveness probe |
| `GET /api/mt5/status` | MT5 bridge connection status |
| `GET /api/market-data/quotes?symbols=XAUUSD,EURUSD` | Live quotes |
| `GET /api/market-data/candles?symbol=XAUUSD&timeframe=M15&limit=200` | Candles |
| `GET /api/trades/recent` | Recent trades |
| `GET /api/journal/...` | Trade journal |
| `GET /api/analytics/...` | Analytics |
| `GET /api/accounts` | Trading accounts |
| `GET /api/economic-calendar` | Economic calendar |

### Symbol formats accepted

Both slash and no-slash formats are normalized automatically:

| Input | Normalized |
|---|---|
| `XAU/USD` | `XAUUSD` |
| `XAUUSD` | `XAUUSD` |
| `EUR/USD` | `EURUSD` |
| `EURUSD` | `EURUSD` |
| `GBP/USD` | `GBPUSD` |
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
No Cloudflare Worker API is involved.
No Vercel API routes handle trading data.

## Development

```powershell
npm run dev:api      # run with tsx watch (hot-reload)
npm run build:api    # compile TypeScript → dist-api/
npm start            # run compiled output
```

## MT5 EA

`mql5/TradeBridgeEA.mq5` sends heartbeats to the Python MT5 bridge on port 8001.

In MT5: `Tools → Options → Expert Advisors → Allow WebRequest for listed URL`:

```
http://127.0.0.1:8001
```
