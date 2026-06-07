# AlphaMentals MT5 Bridge

Servicio standalone para ejecutar en el Windows VPS junto a MetaTrader 5.

## Arranque

```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## Variables

- `PORT=3001`
- `BRIDGE_API_KEY`
- `TRADING_ENABLED=false`
- `LOG_LEVEL=info`

## Endpoints Fase 1-2

- `GET /health`
- `POST /accounts/connect`
- `POST /accounts/disconnect`
- `GET /accounts/:accountId/status`
- `GET /accounts/:accountId/info`
- `GET /accounts/:accountId/positions`
- `POST /ea/heartbeat`

## Auth

- `GET /health` is public.
- All other bridge endpoints require the `x-api-key` header.
- `BRIDGE_API_KEY` on the VPS must match `MT5_BRIDGE_API_KEY` on Render exactly.

Examples:

```bash
curl http://127.0.0.1:3001/health
```

```bash
curl -H "x-api-key: YOUR_KEY" http://127.0.0.1:3001/accounts/demo-account-1/positions
```

Target API examples for later phases:

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3001/accounts/demo-account-1/candles?symbol=XAUUSD&timeframe=M5&limit=500"
```

```bash
curl -X POST http://127.0.0.1:3001/accounts/demo-account-1/trade \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"symbol":"XAUUSD","side":"buy","volume":0.1,"stopLoss":2320.5,"takeProfit":2335.5}'
```

## MT5 EA

`mql5/TradeBridgeEA.mq5` envia cada heartbeat:

- balance
- equity
- margin
- free margin
- profit
- currency
- leverage
- posiciones abiertas

En MT5 abre `Tools > Options > Expert Advisors` y agrega la URL del bridge a `Allow WebRequest for listed URL`.

Ejemplo:

```text
http://127.0.0.1:3001
```

Si Render va a consultar por un `accountId` estable, pon ese mismo valor en el input `BridgeAccountId` del EA.

Las fases siguientes ampliaran candles, precios, historial y ejecucion.
