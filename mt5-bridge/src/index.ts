import express from 'express';
import { requireApiKey } from './auth.js';
import { assertBridgeConfig, bridgeConfig } from './config.js';
import { bridgeRouter } from './routes.js';

assertBridgeConfig();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'alphamentals-mt5-bridge',
    message: 'Bridge online.',
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'alphamentals-mt5-bridge',
    status: 'healthy',
  });
});

app.use(requireApiKey);
app.use(bridgeRouter);

app.listen(bridgeConfig.port, '0.0.0.0', () => {
  console.log(`[mt5-bridge] listening on http://0.0.0.0:${bridgeConfig.port}`);
});
