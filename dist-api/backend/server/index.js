"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const node_net_1 = __importDefault(require("node:net"));
const promises_1 = __importDefault(require("node:fs/promises"));
const marketData_js_1 = require("./routes/marketData.js");
const aiInsights_js_1 = require("./routes/aiInsights.js");
const economicCalendar_js_1 = require("./routes/economicCalendar.js");
const macroData_js_1 = require("./routes/macroData.js");
const forexRates_js_1 = require("./routes/forexRates.js");
const macroSync_js_1 = require("./lib/macroSync.js");
const journal_js_1 = __importDefault(require("./routes/journal.js"));
const playbook_js_1 = __importDefault(require("./routes/playbook.js"));
const analytics_js_1 = __importDefault(require("./routes/analytics.js"));
const coach_js_1 = __importDefault(require("./routes/coach.js"));
const checklist_js_1 = __importDefault(require("./routes/checklist.js"));
const riskManager_js_1 = __importDefault(require("./routes/riskManager.js"));
const metatrader_js_1 = require("./routes/metatrader.js");
const ctrader_js_1 = require("./routes/ctrader.js");
const saxo_js_1 = require("./routes/saxo.js");
const mt5Tracking_js_1 = require("./routes/mt5Tracking.js");
const tradingAccounts_js_1 = require("./routes/tradingAccounts.js");
const accountOnboarding_js_1 = require("./routes/accountOnboarding.js");
const fundamentals_js_1 = require("./routes/fundamentals.js");
const pairs_js_1 = require("./routes/pairs.js");
const tradingviewWebhook_js_1 = require("./routes/tradingviewWebhook.js");
const telegram_js_1 = require("./routes/telegram.js");
const cron_js_1 = require("./routes/cron.js");
const mt5_js_1 = require("./routes/mt5.js");
const tradesExecution_js_1 = require("./routes/tradesExecution.js");
const mt5Bridge_js_1 = require("./routes/mt5Bridge.js");
const newsFetcherJob_js_1 = require("../../src/jobs/newsFetcherJob.js");
const telegram_js_2 = require("./config/telegram.js");
const telegramBridge_service_js_1 = require("./services/telegramBridge.service.js");
const telegramInfo_service_js_1 = require("./services/telegramInfo.service.js");
const telegramSyncScheduler_service_js_1 = require("./services/telegramSyncScheduler.service.js");
const mt5Sync_service_js_1 = require("./services/mt5Sync.service.js");
const notifications_js_1 = require("./routes/notifications.js");
const diagnostics_js_1 = require("./routes/diagnostics.js");
const debug_js_1 = require("./routes/debug.js");
const aiAnalysis_js_1 = require("./routes/aiAnalysis.js");
const cost_js_1 = require("./routes/cost.js");
const marketIntelligence_js_1 = require("./routes/marketIntelligence.js");
const admin_js_1 = require("./routes/admin.js");
const pairAi_js_1 = require("./routes/pairAi.js");
const marketDataService_js_1 = require("../../src/server/marketDataService.js");
const mt5BridgeQuotes_js_1 = require("../../src/server/mt5BridgeQuotes.js");
const openaiConfig_js_1 = require("./lib/openaiConfig.js");
dotenv_1.default.config();
const app = (0, express_1.default)();
const HOST = process.env.API_HOST ?? '0.0.0.0';
const IS_VERCEL = process.env.VERCEL === '1';
const BACKEND_DISCOVERY_FILE = process.env.ALPHAMENTALS_BACKEND_DISCOVERY_FILE ?? '/tmp/alphamentals-backend-discovery.json';
const DISCOVERY_PORTS = [3000, 3001, 3002, 3005, 3333, 4000, 5000, 8000, 8080, 8787];
const ALLOWED_ORIGINS = [
    process.env.FRONTEND_ORIGIN,
    process.env.FRONTEND_ORIGIN_ALT,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.some((o) => origin === o || origin.endsWith('.vercel.app'))) {
            callback(null, true);
        }
        else {
            callback(null, false);
        }
    },
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Requested-With',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use('/api/market-data', marketData_js_1.marketDataRouter);
app.use('/api/ai-insights', aiInsights_js_1.aiInsightsRouter);
app.use('/api/economic-calendar', economicCalendar_js_1.economicCalendarRouter);
app.use('/api/macro', macroData_js_1.macroDataRouter);
app.use('/api/forex-rates', forexRates_js_1.forexRatesRouter);
app.use('/api/journal', journal_js_1.default);
app.use('/api/playbook', playbook_js_1.default);
app.use('/api/analytics', analytics_js_1.default);
app.use('/api/coach', coach_js_1.default);
app.use('/api/checklist', checklist_js_1.default);
app.use('/api/risk', riskManager_js_1.default);
app.use('/api/metatrader', metatrader_js_1.metaTraderRouter);
app.use('/api/ctrader', ctrader_js_1.ctraderRouter);
app.use('/api/saxo', saxo_js_1.saxoRouter);
app.use('/api/mt5-tracking', mt5Tracking_js_1.mt5TrackingRouter);
app.use('/api/trading-accounts', tradingAccounts_js_1.tradingAccountsRouter);
app.use('/api/account-onboarding', accountOnboarding_js_1.accountOnboardingRouter);
app.use('/api/fundamentals', fundamentals_js_1.fundamentalsRouter);
app.use('/api/market-intelligence', marketIntelligence_js_1.marketIntelligenceRouter);
app.use('/api/admin', admin_js_1.adminRouter);
app.use('/api/pairs', pairs_js_1.pairsRouter);
app.use('/api/tradingview-webhook', tradingviewWebhook_js_1.tradingviewWebhookRouter);
app.use('/api/telegram', telegram_js_1.telegramRouter);
app.use('/api/cron', cron_js_1.cronRouter);
app.use('/telegram', telegram_js_1.telegramRouter);
app.use('/api/mt5', mt5_js_1.mt5Router);
app.use('/api/trades', tradesExecution_js_1.tradeExecutionRouter);
app.use('/api/mt5-bridge', mt5Bridge_js_1.mt5BridgeRouter);
app.use('/api/trades', mt5_js_1.tradesRouter);
app.use('/api/notifications', notifications_js_1.notificationsRouter);
app.use('/api/diagnostics', diagnostics_js_1.diagnosticsRouter);
app.use('/api/debug', debug_js_1.debugRouter);
app.use('/api/ai-analysis', aiAnalysis_js_1.aiAnalysisRouter);
app.use('/api/pair-ai', pairAi_js_1.pairAiRouter);
app.use('/api/cost', cost_js_1.costRouter);
function sendHealth(_req, res) {
    const telegram = (0, telegramBridge_service_js_1.getTelegramRuntimeState)();
    res.json({
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
app.get('/api/ping', (_req, res) => res.json({ status: 'ok' }));
app.get('/ping', (_req, res) => res.json({ status: 'ok' }));
// JSON 404 for all unknown /api/* routes — must come after every route registration.
app.use('/api', (req, res) => {
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
function canListen(port) {
    return new Promise((resolve) => {
        const probe = node_net_1.default.createServer();
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
    if (envPort)
        return envPort;
    for (const port of DISCOVERY_PORTS) {
        if (await canListen(port))
            return port;
    }
    return 0;
}
async function writeDiscoveryManifest(port) {
    const connectHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
    const payload = {
        origin: `http://${connectHost}:${port}`,
        host: connectHost,
        port,
        updatedAt: new Date().toISOString(),
        pid: process.pid,
    };
    try {
        await promises_1.default.writeFile(/* turbopackIgnore: true */ BACKEND_DISCOVERY_FILE, JSON.stringify(payload, null, 2), 'utf8');
    }
    catch (error) {
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
            await (0, macroSync_js_1.syncMacroIndicators)();
        }
        catch (err) {
            console.error('[server] Initial macro sync failed:', err.message);
        }
    });
    setInterval(async () => {
        try {
            await (0, macroSync_js_1.syncMacroIndicators)();
        }
        catch (err) {
            console.error('[server] Scheduled macro sync failed:', err.message);
        }
    }, SYNC_INTERVAL_MS);
}
function scheduleFundamentals() {
    setImmediate(() => {
        (0, newsFetcherJob_js_1.startNewsFetcherJob)();
    });
}
async function bootstrap() {
    const port = await resolveListenPort();
    app.listen(port, HOST, async () => {
        const addressHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
        console.log(`[server] Alphamentals API → http://${addressHost}:${port}`);
        await writeDiscoveryManifest(port);
        (0, marketDataService_js_1.validateMarketDataEnv)();
        console.log('[env] MT5_BRIDGE_URL present:', Boolean(process.env.MT5_BRIDGE_URL));
        console.log('[env] MT5_BRIDGE_API_KEY present:', Boolean(process.env.MT5_BRIDGE_API_KEY));
        console.log('[env] MT5_BRIDGE_URL value:', process.env.MT5_BRIDGE_URL ?? null);
        console.log('[server] MT5 bridge config diagnostics', {
            mt5BridgeUrlConfigured: (0, mt5BridgeQuotes_js_1.getBridgeConfigDiagnostics)().mt5BridgeUrlConfigured,
            mt5BridgeApiKeyConfigured: (0, mt5BridgeQuotes_js_1.getBridgeConfigDiagnostics)().mt5BridgeApiKeyConfigured,
        });
        (0, openaiConfig_js_1.logOpenAIConfiguration)();
        if (!process.env.MYFXBOOK_EMAIL)
            console.warn('[server] ⚠️  MYFXBOOK_EMAIL not set — demo calendar data will be used');
        if (IS_VERCEL) {
            console.warn('[server] Vercel detected — background monitors and scheduled jobs are disabled');
            return;
        }
        const telegramValidation = (0, telegram_js_2.getTelegramStartupValidationMessage)();
        if (telegramValidation) {
            console.warn(`[Telegram] ${telegramValidation}`);
        }
        else {
            await (0, telegramBridge_service_js_1.logTelegramStartupDiagnostics)();
            void (0, telegramBridge_service_js_1.startTelegramMonitoring)(async (message) => {
                await (0, telegramInfo_service_js_1.ingestTelegramMessage)(message);
            });
            (0, telegramSyncScheduler_service_js_1.startTelegramSyncScheduler)();
        }
        scheduleMacroSync();
        scheduleFundamentals();
        (0, marketDataService_js_1.startMarketDataScheduler)();
        (0, mt5Sync_service_js_1.scheduleAutomaticMt5Sync)();
    });
}
void bootstrap();
