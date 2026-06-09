import { Router } from 'express';
import { debugMt5BridgeQuotes, getBridgeConfigDiagnostics } from '../../../src/server/mt5BridgeQuotes.js';
import { getOpenAIModel, getPairAiTimeoutMs, isOpenAIConfigured, logOpenAIConfiguration } from '../lib/openaiConfig.js';
import { getPairAiDebugSnapshot } from '../services/pairAnalysis.service.js';

export const debugRouter = Router();

debugRouter.get('/openai', (_req, res) => {
  logOpenAIConfiguration();
  res.json({
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    pairAiTimeoutMs: getPairAiTimeoutMs(),
  });
});

debugRouter.get('/pair-ai/:symbol', async (req, res) => {
  try {
    const snapshot = await getPairAiDebugSnapshot(req.params.symbol, { forceRefresh: false });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to build pair AI debug snapshot.',
      openaiKeyConfigured: isOpenAIConfigured(),
      model: getOpenAIModel(),
      pairAiTimeoutMs: getPairAiTimeoutMs(),
      symbol: req.params.symbol,
    });
  }
});

debugRouter.get('/env', (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();

  res.json({
    mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
    mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
    mt5BridgeUrl: diagnostics.mt5BridgeUrl,
  });
});

debugRouter.get('/mt5-env', (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();

  res.json({
    mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
    mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
    mt5BridgeUrl: diagnostics.mt5BridgeUrl,
  });
});

debugRouter.get('/mt5-quotes', async (req, res) => {
  const symbolsParam = typeof req.query.symbols === 'string' && req.query.symbols.trim()
    ? req.query.symbols
    : 'XAUUSD,EURUSD,GBPUSD';
  const symbols = symbolsParam.split(',').map((symbol) => symbol.trim()).filter(Boolean);
  const result = await debugMt5BridgeQuotes(symbols);
  res.status(result.ok ? 200 : 502).json(result);
});

debugRouter.get('/market-provider', (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    provider: 'mt5-bridge',
    liveQuotes: {
      provider: 'mt5-bridge',
      fallbackEnabled: false,
      twelvedataEnabled: diagnostics.enableTwelveDataQuotes,
      twelvedataUsedForLiveQuotes: false,
    },
    bridge: {
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      symbolMap: diagnostics.bridgeSymbolMap,
    },
    candles: {
      provider: 'unavailable',
      message: 'Candle and technical routes no longer fall back to TwelveData or Yahoo.',
    },
    timestamp: new Date().toISOString(),
  });
});

debugRouter.get('/mt5-bridge-health', async (_req, res) => {
  const bridgeUrl = process.env.MT5_BRIDGE_URL?.replace(/\/$/, '') ?? '';
  const apiKey = process.env.MT5_BRIDGE_API_KEY ?? '';
  const diagnostics = getBridgeConfigDiagnostics();

  if (!bridgeUrl || !apiKey) {
    res.status(503).json({
      ok: false,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      message: 'MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY.',
    });
    return;
  }

  try {
    const endpoint = `${bridgeUrl}/health`;
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    const bodyText = await response.text();
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }

    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      status: response.status,
      body,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      message: error instanceof Error ? error.message : 'Failed to reach MT5 bridge health endpoint.',
    });
  }
});
