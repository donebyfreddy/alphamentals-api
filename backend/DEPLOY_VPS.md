# VPS Deployment Guide — AlphaMentals API

Target architecture:
- **Frontend**: Vercel (`https://alphamentals-dashboard.vercel.app`)
- **API server**: `https://api.alphamentals.com` → this Express process on port 3001
- **MT5 bridge**: Python service on port 8001 (same VPS, internal only)
- **Database**: Supabase

---

## A. System packages

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip nginx certbot python3-certbot-nginx
```

Install Node.js 20 (LTS):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Install PM2 globally:
```bash
sudo npm install -g pm2
```

---

## B. Clone / update repository

```bash
git clone <repo-url> /srv/alphamentals
cd /srv/alphamentals
```

Or to update an existing deployment:
```bash
cd /srv/alphamentals
git pull origin main
```

---

## C. Install Node dependencies

```bash
npm ci
```

---

## D. Environment variables

```bash
cp backend/.env.example .env
nano .env          # fill in real values
```

Key variables:

| Variable | Value |
|---|---|
| `API_PORT` | `3001` |
| `API_HOST` | `0.0.0.0` |
| `FRONTEND_ORIGIN` | `https://alphamentals-dashboard.vercel.app` |
| `MT5_BRIDGE_URL` | `http://127.0.0.1:8001` (Python MT5 bridge) |
| `MT5_BRIDGE_API_KEY` | shared secret with the MT5 Python bridge |
| `VPS_API_KEY` | same value as `MT5_BRIDGE_API_KEY` |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (never expose to frontend) |
| `FINNHUB_API_KEY` | for economic calendar |
| `TRADING_ECONOMICS_API_KEY` | for economic calendar |

---

## E. Build TypeScript

Using the TypeScript compiler (recommended for type checking):
```bash
npm run build:api
```

Or using esbuild (faster, for production when types are already verified):
```bash
npm run build:api:bundle
```

Both output to `dist-api/backend/server/index.js`.

---

## F. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

The `ecosystem.config.js` only starts the **API server** (port 3001).
The **Python MT5 bridge** (port 8001) must be started separately.

Check status:
```bash
pm2 list
pm2 logs alphamentals-api --lines 50
```

---

## G. Nginx reverse proxy

Create `/etc/nginx/sites-available/api.alphamentals.com`:

```nginx
server {
    listen 80;
    server_name api.alphamentals.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api.alphamentals.com \
           /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## H. SSL with Certbot

```bash
sudo certbot --nginx -d api.alphamentals.com
```

Test renewal:
```bash
sudo certbot renew --dry-run
```

---

## I. Vercel frontend — environment variables

In the Vercel dashboard for `alphamentals-dashboard`, set:

```
NEXT_PUBLIC_API_BASE_URL=https://api.alphamentals.com
VPS_API_KEY=<same value as on the VPS>
```

---

## J. Verify deployment

```bash
# Health check (no auth required)
curl -i https://api.alphamentals.com/api/health

# Ping
curl -i https://api.alphamentals.com/api/ping

# Economic calendar (no auth required)
curl -i "https://api.alphamentals.com/api/economic-calendar?from=2026-06-09&to=2026-06-15"

# Market data quotes (no auth required)
curl -i "https://api.alphamentals.com/api/market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD"

# MT5 status
curl -i https://api.alphamentals.com/api/mt5/status

# Journal stats
curl -i https://api.alphamentals.com/api/journal/stats

# Unknown route → JSON 404
curl -i "https://api.alphamentals.com/api/nonexistent-route"
```

Expected:
- `/api/health` → `{"ok":true,"service":"alphamentals-api","kind":"backend",...}`
- `/api/ping` → `{"ok":true}`
- `/api/economic-calendar` → `{"ok":true,"data":[...]}`
- All `/api/*` routes return `Content-Type: application/json`, never HTML
- Unknown routes return `{"ok":false,"error":"NOT_FOUND",...}` with HTTP 404

---

## K. Updating after code changes

```bash
cd /srv/alphamentals
git pull origin main
npm ci
npm run build:api
pm2 restart alphamentals-api
```
