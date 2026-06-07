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
- `GET /market-data/price?symbol=XAUUSD`
- `GET /market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD`
- `GET /market-data/candles?symbol=XAUUSD&timeframe=M5&limit=100`
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

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3001/market-data/price?symbol=XAUUSD"
```

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3001/market-data/quotes?symbols=XAUUSD,EURUSD"
```

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:3001/market-data/candles?symbol=XAUUSD&timeframe=M5&limit=100"
```

External VPS tests:

```bash
curl -H "X-API-Key: <KEY>" "http://217.71.203.77:3001/health"
```

```bash
curl -H "X-API-Key: <KEY>" "http://217.71.203.77:3001/market-data/price?symbol=XAUUSD"
```

```bash
curl -H "X-API-Key: <KEY>" "http://217.71.203.77:3001/market-data/quotes?symbols=XAUUSD,EURUSD"
```

```bash
curl -H "X-API-Key: <KEY>" "http://217.71.203.77:3001/market-data/candles?symbol=XAUUSD&timeframe=M5&limit=100"
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
- quotes para symbols observados

En MT5 abre `Tools > Options > Expert Advisors` y agrega la URL del bridge a `Allow WebRequest for listed URL`.

Ejemplo:

```text
http://127.0.0.1:3001
```

Si Render va a consultar por un `accountId` estable, pon ese mismo valor en el input `BridgeAccountId` del EA.

`/market-data/candles` todavia devuelve un JSON seguro de `MT5_PRICE_SOURCE_NOT_READY` hasta que la integracion de velas con MT5 este conectada.
