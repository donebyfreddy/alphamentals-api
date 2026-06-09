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
const HOST = process.env.API_HOST ?? '0.0.0.0';
const IS_VERCEL = process.env.VERCEL === '1';
const BACKEND_DISCOVERY_FILE = process.env.ALPHAMENTALS_BACKEND_DISCOVERY_FILE ?? '/tmp/alphamentals-backend-discovery.json';
const DISCOVERY_PORTS = [3001, 3000, 3002, 3005, 3333, 4000, 5000, 8000, 8080, 8787];

const ALLOWED_ORIGIN_STRINGS: string[] = [
  process.env.FRONTEND_ORIGIN,
  process.env.FRONTEND_ORIGIN_ALT,
  'https://alphamentals-dashboard.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
].filter(Boolean) as string[];

const VERCEL_PREVIEW_PATTERN = /^https:\/\/alphamentals-dashboard-[a-z0-9-]+-[a-z0-9]+\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin
      || ALLOWED_ORIGIN_STRINGS.includes(origin)
      || VERCEL_PREVIEW_PATTERN.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization, X-Requested-With, x-api-key',
  credentials: true,
}));
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
app.use('/api/trades', tradesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/ai-analysis', aiAnalysisRouter);
app.use('/api/pair-ai', pairAiRouter);
app.use('/api/cost', costRouter);

function sendHealth(_req: express.Request, res: express.Response) {
  const telegram = getTelegramRuntimeState();
  res.json({
    ok: true,
    service: 'alphamentals-api',
    kind: 'backend',
    status: 'ok',
    timestamp: Date.now(),
    telegram: {
      enabled: telegram.enabled,
      connected: telegram.connected,
      target_chat_accessible: telegram.targetChatAccessible,
    },
  });
}

app.get('/api/health', sendHealth);
app.get('/health', sendHealth);
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

function configuredPortCandidates() {
  const explicit = [process.env.API_PORT, process.env.SERVER_PORT, process.env.PORT]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return [...new Set([...explicit, ...DISCOVERY_PORTS])];
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, HOST);
  });
}

async function resolveListenPort() {
  // When PORT is explicitly set (e.g. Render injects PORT=10000), bind to it directly
  // without probing — the probe creates a race condition that causes Render's port
  // scanner to time out before the real server is ready.
  const envPort = [process.env.PORT, process.env.API_PORT, process.env.SERVER_PORT]
    .map(Number)
    .find((p) => Number.isInteger(p) && p > 0);
  if (envPort) return envPort;

  for (const port of DISCOVERY_PORTS) {
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
    await fs.writeFile(/* turbopackIgnore: true */ BACKEND_DISCOVERY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[server] Failed to write backend discovery manifest:', error instanceof Error ? error.message : String(error));
  }
}

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function scheduleMacroSync() {
  if (!process.env.FRED_API_KEY) {
    console.warn('[server] ⚠️  FRED_API_KEY not set — macro sync disabled');
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[server] ⚠️  SUPABASE_SERVICE_ROLE_KEY not set — macro sync disabled');
    return;
  }

  // Run once on startup (non-blocking), then every 24 hours
  setImmediate(async () => {
    try {
      await syncMacroIndicators();
    } catch (err) {
      console.error('[server] Initial macro sync failed:', (err as Error).message);
    }
  });

  setInterval(async () => {
    try {
      await syncMacroIndicators();
    } catch (err) {
      console.error('[server] Scheduled macro sync failed:', (err as Error).message);
    }
  }, SYNC_INTERVAL_MS);
}

function scheduleFundamentals() {
  setImmediate(() => {
    startNewsFetcherJob();
  });
}

async function bootstrap() {
  const port = await resolveListenPort();

  app.listen(port, HOST, async () => {
    const addressHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
    console.log(`[server] Alphamentals API → http://${addressHost}:${port}`);
    await writeDiscoveryManifest(port);
    validateMarketDataEnv();
    console.log('[env] MT5_BRIDGE_URL present:', Boolean(process.env.MT5_BRIDGE_URL));
    console.log('[env] MT5_BRIDGE_API_KEY present:', Boolean(process.env.MT5_BRIDGE_API_KEY));
    console.log('[env] MT5_BRIDGE_URL value:', process.env.MT5_BRIDGE_URL ?? null);
    console.log('[server] MT5 bridge config diagnostics', {
      mt5BridgeUrlConfigured: getBridgeConfigDiagnostics().mt5BridgeUrlConfigured,
      mt5BridgeApiKeyConfigured: getBridgeConfigDiagnostics().mt5BridgeApiKeyConfigured,
    });
    logOpenAIConfiguration();
    if (!process.env.MYFXBOOK_EMAIL) console.warn('[server] ⚠️  MYFXBOOK_EMAIL not set — demo calendar data will be used');
    if (IS_VERCEL) {
      console.warn('[server] Vercel detected — background monitors and scheduled jobs are disabled');
      return;
    }
    const telegramValidation = getTelegramStartupValidationMessage();
    if (telegramValidation) {
      console.warn(`[Telegram] ${telegramValidation}`);
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
