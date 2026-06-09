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
const HOST = process.env.HOST ?? process.env.API_HOST ?? '0.0.0.0';
const PORT_ENV = process.env.PORT ?? process.env.API_PORT ?? process.env.SERVER_PORT;
const BACKEND_DISCOVERY_FILE = process.env.ALPHAMENTALS_BACKEND_DISCOVERY_FILE ?? '/tmp/alphamentals-backend-discovery.json';
const DISCOVERY_PORTS = [3001, 3000, 3002, 3005, 3333, 4000, 5000, 8000, 8080, 8787];
// Parse CORS_ORIGINS env var — comma-separated list of allowed origins
const envCorsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const ALLOWED_ORIGIN_STRINGS = [
    ...envCorsOrigins,
    process.env.FRONTEND_ORIGIN,
    process.env.FRONTEND_ORIGIN_ALT,
    'https://alphamentals-dashboard.pages.dev',
    'https://alphamentals-dashboard.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
].filter((v) => typeof v === 'string' && v.length > 0);
const VERCEL_PREVIEW_PATTERN = /^https:\/\/alphamentals-dashboard-[a-z0-9-]+-[a-z0-9]+\.vercel\.app$/;
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin
            || ALLOWED_ORIGIN_STRINGS.includes(origin)
            || VERCEL_PREVIEW_PATTERN.test(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error(`CORS: origin not allowed — ${origin}`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true,
    optionsSuccessStatus: 204,
};
// Respond to every OPTIONS preflight before any route or auth middleware runs.
app.options('/*splat', (0, cors_1.default)(corsOptions));
app.use((0, cors_1.default)(corsOptions));
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
app.use('/api/accounts', tradingAccounts_js_1.tradingAccountsRouter);
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
function buildHealthPayload(port) {
    const telegram = (0, telegramBridge_service_js_1.getTelegramRuntimeState)();
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
app.use('/api', (req, res) => {
    res.status(404).json({
        ok: false,
        error: 'NOT_FOUND',
        message: 'API route not found',
        path: req.path,
    });
});
function configuredPortCandidates() {
    const explicit = [process.env.PORT, process.env.API_PORT, process.env.SERVER_PORT]
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0);
    return [...new Set([...explicit, ...DISCOVERY_PORTS])];
}
function canListen(port) {
    return new Promise((resolve) => {
        const probe = node_net_1.default.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => { probe.close(() => resolve(true)); });
        probe.listen(port, HOST);
    });
}
async function resolveListenPort() {
    const envPort = PORT_ENV ? Number(PORT_ENV) : Number.NaN;
    if (Number.isInteger(envPort) && envPort > 0)
        return envPort;
    for (const port of configuredPortCandidates()) {
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
        await promises_1.default.writeFile(BACKEND_DISCOVERY_FILE, JSON.stringify(payload, null, 2), 'utf8');
    }
    catch (error) {
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
        try {
            await (0, macroSync_js_1.syncMacroIndicators)();
        }
        catch (err) {
            console.error('[alphamentals-api] initial macro sync failed:', err.message);
        }
    });
    setInterval(async () => {
        try {
            await (0, macroSync_js_1.syncMacroIndicators)();
        }
        catch (err) {
            console.error('[alphamentals-api] scheduled macro sync failed:', err.message);
        }
    }, SYNC_INTERVAL_MS);
}
function scheduleFundamentals() {
    setImmediate(() => { (0, newsFetcherJob_js_1.startNewsFetcherJob)(); });
}
async function bootstrap() {
    const port = await resolveListenPort();
    resolvedPort = port;
    app.listen(port, HOST, async () => {
        console.log(`[alphamentals-api] starting`);
        console.log(`[alphamentals-api] host=${HOST}`);
        console.log(`[alphamentals-api] port=${port}`);
        console.log(`[alphamentals-api] cors origins loaded: ${ALLOWED_ORIGIN_STRINGS.join(', ')}`);
        const bridgeDiag = (0, mt5BridgeQuotes_js_1.getBridgeConfigDiagnostics)();
        console.log(`[alphamentals-api] routes registered`);
        console.log(`[alphamentals-api] mt5 service initialized (bridge configured: ${bridgeDiag.mt5BridgeUrlConfigured})`);
        await writeDiscoveryManifest(port);
        (0, marketDataService_js_1.validateMarketDataEnv)();
        console.log(`[env] MT5_BRIDGE_URL present: ${Boolean(process.env.MT5_BRIDGE_URL)}`);
        console.log(`[env] MT5_BRIDGE_API_KEY present: ${Boolean(process.env.MT5_BRIDGE_API_KEY)}`);
        (0, openaiConfig_js_1.logOpenAIConfiguration)();
        if (!process.env.MYFXBOOK_EMAIL)
            console.warn('[alphamentals-api] MYFXBOOK_EMAIL not set — demo calendar data will be used');
        const telegramValidation = (0, telegram_js_2.getTelegramStartupValidationMessage)();
        if (telegramValidation) {
            console.warn(`[telegram] ${telegramValidation}`);
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
