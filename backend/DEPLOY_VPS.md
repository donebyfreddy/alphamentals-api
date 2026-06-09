# VPS Deployment Guide — AlphaMentals API

Target architecture:
- **Frontend**: Vercel (`https://app.alphamentals.com`)
- **API server**: VPS at `https://api.alphamentals.com` (this guide)
- **MT5 bridge**: VPS, internal port 3001
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

Run once from the **project root** (all dependencies are in the root `package.json`):
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
| `PORT` | `3000` (API server — does NOT conflict with MT5 bridge on 3001) |
| `FRONTEND_ORIGIN` | `https://app.alphamentals.com` |
| `MT5_BRIDGE_URL` | `http://127.0.0.1:3001` |
| `MT5_BRIDGE_API_KEY` | must match `BRIDGE_API_KEY` in MT5 bridge process |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (never expose to frontend) |

The root `.env` is loaded automatically by dotenv on server startup.

---

## E. Build TypeScript

```bash
npm run build:api
```

This compiles `backend/server/` and shared `src/` modules into `dist-api/`.

---

## F. Start with PM2

### API server (this service)
```bash
pm2 start dist-api/backend/server/index.js \
  --name alphamentals-api \
  --env production
pm2 save
pm2 startup
```

### MT5 bridge (runs alongside)
```bash
npm run build                                   # compile root src/
pm2 start dist/src/index.js \
  --name alphamentals-mt5-bridge \
  --env production \
  --env PORT=3001 \
  --env BRIDGE_API_KEY=<same-as-MT5_BRIDGE_API_KEY>
pm2 save
```

Check both are running:
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
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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

Certbot will edit the nginx config automatically to add HTTPS.

Test renewal:
```bash
sudo certbot renew --dry-run
```

---

## I. Vercel frontend — environment variable

In the Vercel dashboard for your frontend project, set:

```
NEXT_PUBLIC_API_BASE_URL=https://api.alphamentals.com
```

Remove any references to:
- Cloudflare Worker URLs
- Render URLs
- `http://217.71.203.77:...` raw IP addresses
- `http://localhost:...`

---

## J. Verify deployment

Run these from any machine after the VPS is up:

```bash
curl -i https://api.alphamentals.com/health
curl -i https://api.alphamentals.com/api/health
curl -i "https://api.alphamentals.com/api/market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD,DXY,USOIL"
curl -i https://api.alphamentals.com/api/mt5/status
curl -i https://api.alphamentals.com/api/journal/stats
curl -i "https://api.alphamentals.com/api/journal/trades?page=1&limit=25"
curl -i "https://api.alphamentals.com/api/economic-calendar?from=2026-06-08&to=2026-06-14"
curl -i "https://api.alphamentals.com/api/nonexistent-route"
```

Expected:
- Every response has `Content-Type: application/json`
- `/api/nonexistent-route` returns `{"ok":false,"error":"NOT_FOUND",...}` with HTTP 404
- `/api/market-data/quotes` returns `{"ok":true,"data":{...}}`
- All `/api/*` routes return JSON, never HTML

---

## K. Updating after code changes

```bash
cd /srv/alphamentals
git pull origin main
npm ci
npm run build:api
pm2 restart alphamentals-api
```
