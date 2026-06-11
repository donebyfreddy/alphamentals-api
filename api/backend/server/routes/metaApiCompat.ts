import { Router } from 'express';

export const metaApiCompatRouter = Router();

function disabledPayload() {
  return {
    ok: false,
    error: 'METAAPI_DISABLED',
    message: 'MetaApi is disabled. This deployment uses Windows VPS MetaTrader 5 only.',
    provider: 'windows-vps-mt5',
    endpoints: {
      status: '/api/mt5/status',
      candles: '/api/market-data/candles',
      quotes: '/api/market-data/quotes',
    },
  };
}

metaApiCompatRouter.all('/*splat', (_req, res) => {
  res.status(410).json(disabledPayload());
});

metaApiCompatRouter.get('/', (_req, res) => {
  res.status(410).json(disabledPayload());
});
