"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMt5AccountNow = syncMt5AccountNow;
exports.getMt5Status = getMt5Status;
exports.getRecentTrades = getRecentTrades;
exports.scheduleAutomaticMt5Sync = scheduleAutomaticMt5Sync;
const db_js_1 = require("../lib/db.js");
const supabase_js_1 = require("../lib/supabase.js");
const metaTrader_service_js_1 = require("./metaTrader.service.js");
const notification_service_js_1 = require("./notification.service.js");
const mt5Sync_helpers_js_1 = require("./mt5Sync.helpers.js");
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? null;
const AUTO_SYNC_INTERVAL_MS = Number(process.env.MT5_AUTO_SYNC_INTERVAL_MS ?? 60_000);
let syncInFlight = null;
let lastSyncError = null;
function humanizeMt5SyncError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Can't reach database server")) {
        return 'Trade journal database is unavailable. Check your Supabase/DB connection before syncing MT5 trades.';
    }
    if (message.toLowerCase().includes('connection timeout')) {
        return 'MT5 connection timed out while fetching account data.';
    }
    return message;
}
function getConfiguredMt5Credentials() {
    const login = process.env.MT5_LOGIN?.trim();
    const password = process.env.MT5_PASSWORD?.trim();
    const server = process.env.MT5_SERVER?.trim();
    if (!login || !password || !server)
        return null;
    return {
        version: 'mt5',
        login,
        password,
        server,
        accountType: (process.env.MT5_ACCOUNT_TYPE?.trim() || 'demo'),
        passwordType: (process.env.MT5_PASSWORD_TYPE?.trim() || 'investor'),
    };
}
async function ensureTradeImportColumns() {
    // Guard: silently skip if the trades table doesn't exist yet (first-run / fresh DB).
    // Columns are created by the migration; this is a safety backfill for pre-migration DBs.
    try {
        await (0, db_js_1.execute)(`
      ALTER TABLE trades
        ADD COLUMN IF NOT EXISTS "importSource" TEXT,
        ADD COLUMN IF NOT EXISTS "isAutoImported" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "externalTradeId" TEXT,
        ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT,
        ADD COLUMN IF NOT EXISTS "externalPositionId" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerAccountId" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerAccountLogin" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerServer" TEXT,
        ADD COLUMN IF NOT EXISTS "durationMinutes" INT4;
    `);
        await (0, db_js_1.execute)(`
      CREATE UNIQUE INDEX IF NOT EXISTS trades_user_source_external_trade_uidx
      ON trades ("userId", "importSource", "externalTradeId")
      WHERE "externalTradeId" IS NOT NULL AND "importSource" IS NOT NULL;
    `);
    }
    catch (err) {
        console.warn('[MT5 Sync] Could not ensure trade import columns (safe to ignore if table was pre-created by migration):', err instanceof Error ? err.message : String(err));
    }
}
function mapAccountRow(row) {
    return {
        id: String(row.id),
        userId: String(row.userId),
        brokerName: String(row.brokerName),
        accountLogin: String(row.accountLogin),
        serverName: String(row.serverName),
        accountType: String(row.accountType),
        status: String(row.status),
        lastSyncedAt: row.lastSyncedAt ? String(row.lastSyncedAt) : null,
        createdAt: String(row.createdAt),
    };
}
async function getOrCreateLinkedAccount(userId, account, credentials) {
    const payload = {
        userId,
        brokerName: account.broker || credentials.server,
        accountLogin: account.login,
        serverName: account.server,
        accountType: credentials.accountType,
        status: 'connected',
        lastSyncedAt: new Date().toISOString(),
    };
    const { data, error } = await supabase_js_1.supabase
        .from('mt5_connected_accounts')
        .upsert(payload, { onConflict: 'userId,accountLogin,serverName' })
        .select('*')
        .single();
    if (error || !data) {
        throw new Error(error?.message ?? 'Failed to persist linked MT5 account.');
    }
    return mapAccountRow(data);
}
async function replaceOpenPositions(account, openTrades) {
    await supabase_js_1.supabase.from('mt5_open_positions').delete().eq('accountId', account.id);
    if (!openTrades.length)
        return;
    const rows = openTrades.map((trade) => ({
        userId: account.userId,
        accountId: account.id,
        ticket: trade.externalTradeId,
        symbol: trade.symbol,
        type: trade.direction === 'LONG' ? 'buy' : 'sell',
        volume: trade.volume,
        openPrice: trade.entryPrice,
        currentPrice: trade.currentPrice,
        profit: trade.profit,
        openTime: trade.openTime,
        rawPayload: trade.rawPosition,
    }));
    const { error } = await supabase_js_1.supabase.from('mt5_open_positions').insert(rows);
    if (error)
        throw new Error(error.message);
}
async function upsertMt5TradeRows(account, closedTrades) {
    if (!closedTrades.length)
        return;
    const rows = closedTrades.map((trade) => ({
        userId: account.userId,
        accountId: account.id,
        ticket: trade.externalTradeId,
        symbol: trade.symbol,
        type: trade.direction === 'LONG' ? 'buy' : 'sell',
        volume: trade.volume,
        openPrice: trade.entryPrice,
        closePrice: trade.closePrice,
        openTime: trade.openTime,
        closeTime: trade.closeTime,
        profit: trade.profit,
        commission: trade.commission,
        swap: trade.swap,
        comment: trade.comment,
        rawPayload: trade.rawDeals,
    }));
    const { error } = await supabase_js_1.supabase
        .from('mt5_trades')
        .upsert(rows, { onConflict: 'accountId,ticket' });
    if (error)
        throw new Error(error.message);
}
async function insertEquitySnapshot(account, snapshot) {
    const { error } = await supabase_js_1.supabase.from('mt5_equity_snapshots').insert({
        userId: account.userId,
        accountId: account.id,
        balance: snapshot.balance,
        equity: snapshot.equity,
        drawdown: snapshot.balance > 0 ? Number((((snapshot.balance - snapshot.equity) / snapshot.balance) * 100).toFixed(3)) : null,
    });
    if (error)
        throw new Error(error.message);
}
function tradeTags(symbol, status) {
    return ['MT5', 'AUTO_IMPORTED', status, symbol].filter(Boolean);
}
async function upsertJournalTrade(params) {
    const isClosedTrade = 'closePrice' in params.mt5Trade;
    const closePrice = isClosedTrade ? params.mt5Trade.closePrice : null;
    const closeTime = isClosedTrade ? params.mt5Trade.closeTime : null;
    const analysis = (0, mt5Sync_helpers_js_1.buildTradeAnalysis)({
        symbol: params.mt5Trade.symbol,
        direction: params.mt5Trade.direction,
        entryPrice: params.mt5Trade.entryPrice,
        closePrice,
        profit: params.mt5Trade.profit,
        openTime: params.mt5Trade.openTime,
        closeTime,
        account: params.accountSnapshot,
    });
    const existingQuery = await supabase_js_1.supabase
        .from('trades')
        .select('id')
        .eq('userId', params.account.userId)
        .eq('importSource', 'MT5')
        .eq('externalTradeId', params.mt5Trade.externalTradeId)
        .maybeSingle();
    const payload = {
        userId: params.account.userId,
        tradeNumber: 0,
        symbol: params.mt5Trade.symbol,
        direction: params.mt5Trade.direction,
        status: params.status,
        entryPrice: params.mt5Trade.entryPrice,
        stopLoss: params.mt5Trade.entryPrice,
        takeProfit: closePrice ?? params.mt5Trade.entryPrice,
        closePrice,
        positionSize: params.mt5Trade.volume,
        riskPercent: 0,
        rrPlanned: 0,
        rrActual: analysis.rrActual,
        pnl: analysis.pnl,
        pnlPercent: analysis.pnlPercent,
        pnlPips: analysis.pnlPips,
        session: analysis.session,
        timeframe: 'MT5_AUTO',
        setupType: 'MT5_SYNC',
        confluences: ['MT5_SYNC'],
        tags: tradeTags(params.mt5Trade.symbol, params.status),
        preTradeEmotion: 'NEUTRAL',
        confidenceLevel: 5,
        followedPlan: null,
        isRevengeTrade: false,
        isFomo: false,
        tradePlan: 'Imported automatically from linked MT5 account.',
        reasonForEntry: `MT5 auto-import from ${params.account.accountLogin}`,
        reasonForExit: params.status === 'CLOSED' ? 'Closed in MT5 and synced automatically.' : null,
        lessonsLearned: null,
        mistakeTags: [],
        mentorNotes: `Source=MT5 | Account=${params.account.accountLogin} | Server=${params.account.serverName}`,
        // Scores are NOT fabricated on import. They stay null until the user
        // completes a post-trade review, which recomputes them deterministically.
        aiReview: analysis.aiReview,
        aiScore: null,
        setupQuality: null,
        executionScore: null,
        psychologyScore: null,
        disciplineScore: null,
        riskScore: null,
        reviewStatus: 'NEEDS_REVIEW',
        screenshotUrls: [],
        checklistId: null,
        entryTime: params.mt5Trade.openTime ?? new Date().toISOString(),
        exitTime: closeTime,
        importSource: 'MT5',
        isAutoImported: true,
        externalTradeId: params.mt5Trade.externalTradeId,
        externalOrderId: params.externalOrderId ?? null,
        externalPositionId: params.externalPositionId ?? null,
        brokerAccountId: params.account.id,
        brokerAccountLogin: params.account.accountLogin,
        brokerServer: params.account.serverName,
        durationMinutes: analysis.durationMinutes,
    };
    if (existingQuery.data?.id) {
        // Re-sync: refresh only market/execution data. Never touch the user's
        // review fields (scores, emotions, mistakes, narrative, reviewStatus) so a
        // completed review survives subsequent syncs.
        const marketUpdate = {
            status: payload.status,
            closePrice: payload.closePrice,
            pnl: payload.pnl,
            pnlPercent: payload.pnlPercent,
            pnlPips: payload.pnlPips,
            rrActual: payload.rrActual,
            exitTime: payload.exitTime,
            durationMinutes: payload.durationMinutes,
        };
        const { error } = await supabase_js_1.supabase.from('trades').update(marketUpdate).eq('id', existingQuery.data.id);
        if (error)
            throw new Error(error.message);
        return 'updated';
    }
    const nextTradeNumber = await supabase_js_1.supabase
        .from('trades')
        .select('tradeNumber')
        .eq('userId', params.account.userId)
        .order('tradeNumber', { ascending: false })
        .limit(1)
        .maybeSingle();
    const tradeNumber = Number(nextTradeNumber.data?.tradeNumber ?? 0) + 1;
    const { error } = await supabase_js_1.supabase.from('trades').insert({
        ...payload,
        tradeNumber,
    });
    if (error)
        throw new Error(error.message);
    return 'created';
}
async function syncJournalTrades(account, accountSnapshot, openTrades, closedTrades) {
    let created = 0;
    let updated = 0;
    for (const trade of openTrades) {
        const result = await upsertJournalTrade({
            account,
            mt5Trade: trade,
            accountSnapshot,
            status: 'OPEN',
        });
        if (result === 'created')
            created++;
        else
            updated++;
    }
    for (const trade of closedTrades) {
        const result = await upsertJournalTrade({
            account,
            mt5Trade: trade,
            accountSnapshot,
            status: 'CLOSED',
            externalOrderId: trade.externalOrderId,
            externalPositionId: trade.externalPositionId,
        });
        if (result === 'created')
            created++;
        else
            updated++;
    }
    return { created, updated };
}
function assertSyncReady(result) {
    if (!result.success || !result.account) {
        throw new Error(result.error?.message ?? 'MT5 sync failed to retrieve account data.');
    }
}
async function performMt5Sync(credentials) {
    const userId = DEFAULT_USER_ID;
    if (!userId)
        throw new Error('DEFAULT_USER_ID is not configured. Set DEFAULT_USER_ID in your .env file.');
    if (!process.env.METAAPI_TOKEN) {
        throw new Error('METAAPI_TOKEN is not set. MetaApi cloud connection requires a valid token in your .env file.');
    }
    console.log(`[MT5 Sync] Starting sync for account ${credentials.login} on server ${credentials.server}`);
    await ensureTradeImportColumns();
    const result = await (0, metaTrader_service_js_1.connectMetaTrader)(credentials);
    if (!result.success) {
        const errMsg = result.error?.message ?? 'MetaApi connection failed without a specific error message.';
        const errCode = result.error?.code ?? 'UNKNOWN';
        console.error(`[MT5 Sync] MetaApi connection failed. code=${errCode} message=${errMsg}`);
        throw new Error(`MetaApi sync failed [${errCode}]: ${errMsg}`);
    }
    if (!result.account)
        throw new Error('MetaApi returned success but no account snapshot — unexpected response.');
    const linkedAccount = await getOrCreateLinkedAccount(userId, result.account, credentials);
    const openTrades = (0, mt5Sync_helpers_js_1.normalizeOpenPositions)(result.positions ?? []);
    const closedTrades = (0, mt5Sync_helpers_js_1.normalizeClosedTrades)(result.history ?? []);
    console.log(`[MT5 Sync] Open positions fetched: ${openTrades.length}`);
    console.log(`[MT5 Sync] Closed trades fetched: ${closedTrades.length}`);
    await Promise.all([
        replaceOpenPositions(linkedAccount, openTrades),
        upsertMt5TradeRows(linkedAccount, closedTrades),
        insertEquitySnapshot(linkedAccount, result.account),
    ]);
    const journal = await syncJournalTrades(linkedAccount, result.account, openTrades, closedTrades);
    console.log(`[MT5 Sync] Journal entries created: ${journal.created}`);
    console.log(`[MT5 Sync] Journal entries updated: ${journal.updated}`);
    const syncTime = new Date().toISOString();
    const { error: accountUpdateError } = await supabase_js_1.supabase
        .from('mt5_connected_accounts')
        .update({ status: 'connected', lastSyncedAt: syncTime })
        .eq('id', linkedAccount.id);
    if (accountUpdateError) {
        throw new Error(accountUpdateError.message);
    }
    const recentTrades = await getRecentTrades(5);
    console.log(`[MT5 Sync] Recent trades available: ${recentTrades.length}`);
    console.log('[MT5 Sync] Completed successfully');
    lastSyncError = null;
    return {
        success: true,
        accountId: linkedAccount.id,
        accountLogin: linkedAccount.accountLogin,
        fetchedOpenPositions: openTrades.length,
        fetchedClosedTrades: closedTrades.length,
        journalEntriesCreated: journal.created,
        journalEntriesUpdated: journal.updated,
        recentTradesAvailable: recentTrades.length,
        lastSyncTime: syncTime,
        errors: [],
    };
}
async function syncMt5AccountNow() {
    const credentials = getConfiguredMt5Credentials();
    if (!credentials) {
        return {
            success: false,
            accountId: null,
            accountLogin: null,
            fetchedOpenPositions: 0,
            fetchedClosedTrades: 0,
            journalEntriesCreated: 0,
            journalEntriesUpdated: 0,
            recentTradesAvailable: 0,
            lastSyncTime: null,
            errors: ['MT5 account credentials are not configured server-side.'],
        };
    }
    if (syncInFlight)
        return syncInFlight;
    syncInFlight = performMt5Sync(credentials)
        .catch((error) => {
        const message = humanizeMt5SyncError(error);
        lastSyncError = message;
        // Route the failure through the central notification hub (never blocks/throws).
        void (0, notification_service_js_1.createNotification)({
            title: 'MT5 account sync failed',
            message,
            category: 'account_sync',
            severity: 'critical',
            source: 'mt5_sync',
            metadata: { accountLogin: credentials.login },
            dedupeKey: 'mt5-sync-failure',
        });
        return {
            success: false,
            accountId: null,
            accountLogin: credentials.login,
            fetchedOpenPositions: 0,
            fetchedClosedTrades: 0,
            journalEntriesCreated: 0,
            journalEntriesUpdated: 0,
            recentTradesAvailable: 0,
            lastSyncTime: null,
            errors: [message],
        };
    })
        .finally(() => {
        syncInFlight = null;
    });
    return syncInFlight;
}
async function getMt5Status() {
    await ensureTradeImportColumns();
    const userId = DEFAULT_USER_ID;
    const credentials = getConfiguredMt5Credentials();
    const bridge = (0, metaTrader_service_js_1.getBridgeStatus)();
    const { data: accountRow } = userId
        ? await supabase_js_1.supabase
            .from('mt5_connected_accounts')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };
    const account = accountRow ? mapAccountRow(accountRow) : null;
    const openTrades = account
        ? await supabase_js_1.supabase.from('mt5_open_positions').select('id', { count: 'exact', head: true }).eq('accountId', account.id)
        : { count: 0 };
    const closedTrades = account
        ? await supabase_js_1.supabase.from('mt5_trades').select('id', { count: 'exact', head: true }).eq('accountId', account.id)
        : { count: 0 };
    const journalTrades = userId
        ? await supabase_js_1.supabase.from('trades').select('id', { count: 'exact', head: true }).eq('userId', userId).eq('importSource', 'MT5')
        : { count: 0 };
    return {
        apiReachable: bridge.configured && bridge.ready && Boolean(credentials),
        linkedAccountExists: Boolean(account),
        lastSyncTime: account?.lastSyncedAt ?? null,
        openTrades: openTrades.count ?? 0,
        closedTradesSynced: closedTrades.count ?? 0,
        journalTradesSynced: journalTrades.count ?? 0,
        lastError: lastSyncError,
        accountLogin: account?.accountLogin ?? credentials?.login ?? null,
        serverName: account?.serverName ?? credentials?.server ?? null,
    };
}
async function getRecentTrades(limit = 5) {
    await ensureTradeImportColumns();
    const userId = DEFAULT_USER_ID;
    if (!userId)
        return [];
    const { data, error } = await supabase_js_1.supabase
        .from('trades')
        .select('*')
        .eq('userId', userId)
        .eq('importSource', 'MT5')
        .order('entryTime', { ascending: false })
        .limit(limit);
    if (error)
        throw new Error(error.message);
    return (data ?? []).map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        lotSize: trade.positionSize,
        positionSize: trade.positionSize,
        riskPercent: trade.riskPercent,
        status: trade.status,
        openTime: trade.entryTime,
        closeTime: trade.exitTime,
        pnl: trade.pnl,
        pips: trade.pnlPips,
        accountName: trade.brokerAccountLogin ? `MT5 ${trade.brokerAccountLogin}` : 'MT5 account',
        accountLogin: trade.brokerAccountLogin ?? null,
        source: 'MT5',
        setupType: trade.setupType,
    }));
}
function scheduleAutomaticMt5Sync() {
    const credentials = getConfiguredMt5Credentials();
    if (!process.env.METAAPI_TOKEN) {
        console.warn('[MT5 Sync] METAAPI_TOKEN not set — automatic MT5 sync disabled.');
        return;
    }
    if (!DEFAULT_USER_ID) {
        console.warn('[MT5 Sync] DEFAULT_USER_ID not set — automatic MT5 sync disabled.');
        return;
    }
    if (!credentials) {
        console.warn('[MT5 Sync] MT5_LOGIN / MT5_PASSWORD / MT5_SERVER not set — automatic MT5 sync disabled.');
        return;
    }
    console.log(`[MT5 Sync] Scheduling automatic sync for account ${credentials.login} every ${AUTO_SYNC_INTERVAL_MS / 1000}s.`);
    setImmediate(() => {
        void syncMt5AccountNow();
    });
    setInterval(() => {
        void syncMt5AccountNow();
    }, AUTO_SYNC_INTERVAL_MS);
}
