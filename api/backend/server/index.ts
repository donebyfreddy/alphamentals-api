import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import net from 'node:net';
import fs from 'node:fs/promises';
import { marketDataRouter } from './routes/marketData.js';
import { aiInsightsRouter } from './routes/aiInsights.js';
import { economicCalendarRouter } from './routes/economicCalendar.js';
import { macroDataRouter } from './routes/macroData.js';
import { forexRatesRouter } from './routes/forexRates.js';
import { syncMacroIndicators } from './lib/macroSync.js';
import journalRouter from './routes/journal.js';
import playbookRouter from './routes/playbook.js';
import analyticsRouter from './routes/analytics.js';
import coachRouter from './routes/coach.js';
import checklistRouter from './routes/checklist.js';
import riskManagerRouter from './routes/riskManager.js';
import { metaTraderRouter } from './routes/metatrader.js';
import { ctraderRouter } from './routes/ctrader.js';
import { saxoRouter } from './routes/saxo.js';
import { mt5TrackingRouter } from './routes/mt5Tracking.js';
import { tradingAccountsRouter } from './routes/tradingAccounts.js';
import { accountOnboardingRouter } from './routes/accountOnboarding.js';
import { fundamentalsRouter } from './routes/fundamentals.js';
import { pairsRouter } from './routes/pairs.js';
import { tradingviewWebhookRouter } from './routes/tradingviewWebhook.js';
import { telegramRouter } from './routes/telegram.js';
import { cronRouter } from './routes/cron.js';
import { mt5Router, tradesRouter } from './routes/mt5.js';
import { tradeExecutionRouter } from './routes/tradesExecution.js';
import { mt5BridgeRouter } from './routes/mt5Bridge.js';
import { eaBridgeRouter } from './routes/eaBridge.js';
import { startNewsFetcherJob } from '../../src/jobs/newsFetcherJob.js';
import { getTelegramStartupValidationMessage } from './config/telegram.js';
import { getTelegramRuntimeState, logTelegramStartupDiagnostics, startTelegramMonitoring } from './services/telegramBridge.service.js';
import { ingestTelegramMessage } from './services/telegramInfo.service.js';
import { startTelegramSyncScheduler } from './services/telegramSyncScheduler.service.js';
import { scheduleAutomaticMt5Sync } from './services/mt5Sync.service.js';
import { notificationsRouter } from './routes/notifications.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { debugRouter } from './routes/debug.js';
import { aiAnalysisRouter } from './routes/aiAnalysis.js';
import { costRouter } from './routes/cost.js';
import { marketIntelligenceRouter } from './routes/marketIntelligence.js';
import { adminRouter } from './routes/admin.js';
import { pairAiRouter } from './routes/pairAi.js';
import { startMarketDataScheduler, validateMarketDataEnv } from '../../src/server/marketDataService.js';
import { getBridgeConfigDiagnostics } from '../../src/server/mt5BridgeQuotes.js';
import { logOpenAIConfiguration } from './lib/openaiConfig.js';

dotenv.config();

const app = express();
const HOST = process.env.HOST ?? process.env.API_HOST ?? '0.0.0.0';
const PORT_ENV = process.env.PORT ?? process.env.API_PORT ?? process.env.SERVER_PORT;
const BACKEND_DISCOVERY_FILE = process.env.ALPHAMENTALS_BACKEND_DISCOVERY_FILE ?? '/tmp/alphamentals-backend-discovery.json';
const DISCOVERY_PORTS = [3001, 3000, 3002, 3005, 3333, 4000, 5000, 8000, 8080, 8787];

// Parse CORS_ORIGINS env var — comma-separated list of allowed origins
const envCorsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGIN_STRINGS: string[] = [
  ...envCorsOrigins,
  process.env.FRONTEND_ORIGIN,
  process.env.FRONTEND_ORIGIN_ALT,
  'https://alphamentals-dashboard.pages.dev',
  'https://alphamentals-dashboard.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
].filter((v): v is string => typeof v === 'string' && v.length > 0);

const VERCEL_PREVIEW_PATTERN = /^https:\/\/alphamentals-dashboard-[a-z0-9-]+-[a-z0-9]+\.vercel\.app$/;

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (
      !origin
      || ALLOWED_ORIGIN_STRINGS.includes(origin)
      || VERCEL_PREVIEW_PATTERN.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Respond to every OPTIONS preflight before any route or auth middleware runs.
app.options('/*splat', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

app.use('/api/market-data', marketDataRouter);
app.use('/api/ai-insights', aiInsightsRouter);
app.use('/api/economic-calendar', economicCalendarRouter);
app.use('/api/macro', macroDataRouter);
app.use('/api/forex-rates', forexRatesRouter);
app.use('/api/journal', journalRouter);
app.use('/api/playbook', playbookRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/coach', coachRouter);
app.use('/api/checklist', checklistRouter);
app.use('/api/risk', riskManagerRouter);
app.use('/api/metatrader', metaTraderRouter);
app.use('/api/ctrader', ctraderRouter);
app.use('/api/saxo', saxoRouter);
app.use('/api/mt5-tracking', mt5TrackingRouter);
app.use('/api/trading-accounts', tradingAccountsRouter);
app.use('/api/accounts', tradingAccountsRouter);
app.use('/api/account-onboarding', accountOnboardingRouter);
app.use('/api/fundamentals', fundamentalsRouter);
app.use('/api/market-intelligence', marketIntelligenceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/pairs', pairsRouter);
app.use('/api/tradingview-webhook', tradingviewWebhookRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/cron', cronRouter);
app.use('/telegram', telegramRouter);
app.use('/api/mt5', mt5Router);
app.use('/api/trades', tradeExecutionRouter);
app.use('/api/mt5-bridge', mt5BridgeRouter);
app.use('/ea', eaBridgeRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/ai-analysis', aiAnalysisRouter);
app.use('/api/pair-ai', pairAiRouter);
app.use('/api/cost', costRouter);

function buildHealthPayload(port: number) {
  const telegram = getTelegramRuntimeState();
  return {
    ok: true,
    service: 'alphamentals-api',
    kind: 'backend',
    status: 'ok',
    env: process.env.NODE_ENV ?? 'development',
    host: HOST,
    port,
    timestamp: Date.now(),
    telegram: {
      enabled: telegram.enabled,
      connected: telegram.connected,
      target_chat_accessible: telegram.targetChatAccessible,
    },
  };
}

// Health port is resolved after listen — store it once known.
let resolvedPort = 3001;

app.get('/api/health', (_req, res) => res.json(buildHealthPayload(resolvedPort)));
app.get('/health', (_req, res) => res.json(buildHealthPayload(resolvedPort)));
app.get('/api/ping', (_req, res) => res.json({ ok: true }));
app.get('/ping', (_req, res) => res.json({ ok: true }));

// JSON 404 for all unknown /api/* routes — must come after every route registration.
app.use('/api', (req: express.Request, res: express.Response) => {
  res.status(404).json({
    ok: false,
    error: 'NOT_FOUND',
    message: 'API route not found',
    path: req.path,
  });
});

// Global error handler — catches malformed JSON bodies (e.g. MQL5 null-byte bug)
// and any other unhandled route errors.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const error = err as { type?: string; message?: string; status?: number };
  if (error.type === 'entity.parse.failed') {
    console.error(`[json-parse-error] ${req.method} ${req.path} content-type=${req.headers['content-type'] ?? ''} err=${error.message ?? ''}`);
    res.status(400).json({ ok: false, error: 'Invalid JSON body', detail: error.message });
    return;
  }
  console.error(`[server-error] ${req.method} ${req.path}`, err);
  res.status(error.status ?? 500).json({ ok: false, error: 'Internal server error' });
});

function configuredPortCandidates() {
  const explicit = [process.env.PORT, process.env.API_PORT, process.env.SERVER_PORT]
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set([...explicit, ...DISCOVERY_PORTS])];
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => { probe.close(() => resolve(true)); });
    probe.listen(port, HOST);
  });
}

async function resolveListenPort() {
  const envPort = PORT_ENV ? Number(PORT_ENV) : Number.NaN;
  if (Number.isInteger(envPort) && envPort > 0) return envPort;

  for (const port of configuredPortCandidates()) {
    if (await canListen(port)) return port;
  }
  return 0;
}

async function writeDiscoveryManifest(port: number) {
  const connectHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  const payload = {
    origin: `http://${connectHost}:${port}`,
    host: connectHost,
    port,
    updatedAt: new Date().toISOString(),
    pid: process.pid,
  };
  try {
    await fs.writeFile(BACKEND_DISCOVERY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[alphamentals-api] failed to write backend discovery manifest:', error instanceof Error ? error.message : String(error));
  }
}

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

function scheduleMacroSync() {
  if (!process.env.FRED_API_KEY) {
    console.warn('[alphamentals-api] FRED_API_KEY not set — macro sync disabled');
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[alphamentals-api] SUPABASE_SERVICE_ROLE_KEY not set — macro sync disabled');
    return;
  }

  setImmediate(async () => {
    try { await syncMacroIndicators(); }
    catch (err) { console.error('[alphamentals-api] initial macro sync failed:', (err as Error).message); }
  });

  setInterval(async () => {
    try { await syncMacroIndicators(); }
    catch (err) { console.error('[alphamentals-api] scheduled macro sync failed:', (err as Error).message); }
  }, SYNC_INTERVAL_MS);
}

function scheduleFundamentals() {
  setImmediate(() => { startNewsFetcherJob(); });
}

async function bootstrap() {
  const port = await resolveListenPort();
  resolvedPort = port;

  app.listen(port, HOST, async () => {
    console.log(`[alphamentals-api] starting`);
    console.log(`[alphamentals-api] host=${HOST}`);
    console.log(`[alphamentals-api] port=${port}`);
    console.log(`[alphamentals-api] cors origins loaded: ${ALLOWED_ORIGIN_STRINGS.join(', ')}`);

    const bridgeDiag = getBridgeConfigDiagnostics();
    console.log(`[alphamentals-api] routes registered`);
    console.log(`[alphamentals-api] mt5 service initialized (bridge configured: ${bridgeDiag.mt5BridgeUrlConfigured})`);

    await writeDiscoveryManifest(port);
    validateMarketDataEnv();

    console.log(`[env] MT5_BRIDGE_URL present: ${Boolean(process.env.MT5_BRIDGE_URL)}`);
    console.log(`[env] MT5_BRIDGE_API_KEY present: ${Boolean(process.env.MT5_BRIDGE_API_KEY)}`);
    logOpenAIConfiguration();

    if (!process.env.MYFXBOOK_EMAIL) console.warn('[alphamentals-api] MYFXBOOK_EMAIL not set — demo calendar data will be used');

    const telegramValidation = getTelegramStartupValidationMessage();
    if (telegramValidation) {
      console.warn(`[telegram] ${telegramValidation}`);
    } else {
      await logTelegramStartupDiagnostics();
      void startTelegramMonitoring(async (message) => {
        await ingestTelegramMessage(message);
      });
      startTelegramSyncScheduler();
    }
    scheduleMacroSync();
    scheduleFundamentals();
    startMarketDataScheduler();
    scheduleAutomaticMt5Sync();
  });
}

void bootstrap();
