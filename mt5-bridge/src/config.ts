import 'dotenv/config';

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return value.toLowerCase() === 'true';
}

export const bridgeConfig = {
  port: Number(process.env.PORT ?? 3001),
  apiKey: process.env.BRIDGE_API_KEY ?? '',
  tradingEnabled: parseBoolean(process.env.TRADING_ENABLED, false),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

export function assertBridgeConfig() {
  const missing: string[] = [];
  if (!bridgeConfig.apiKey) missing.push('BRIDGE_API_KEY');
  if (!Number.isFinite(bridgeConfig.port) || bridgeConfig.port <= 0) missing.push('PORT');

  if (missing.length) {
    throw new Error(`Missing bridge environment variables: ${missing.join(', ')}`);
  }
}
