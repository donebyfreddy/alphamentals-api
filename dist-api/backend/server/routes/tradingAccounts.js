"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradingAccountsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const supabase_js_1 = require("../lib/supabase.js");
exports.tradingAccountsRouter = (0, express_1.Router)();
const accountStatusSchema = zod_1.z.enum([
    'connected',
    'connecting',
    'error',
    'failed',
    'pending',
    'unavailable',
    'invalid_credentials',
    'disconnected',
    'syncing',
    'demo',
]);
const accountSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    broker: zod_1.z.string().default(''),
    platform: zod_1.z.string().min(1),
    metatraderVersion: zod_1.z.enum(['mt4', 'mt5']).optional().nullable(),
    mt5AccountNumber: zod_1.z.string().optional().nullable(),
    mt5Server: zod_1.z.string().optional().nullable(),
    mtConnectionKey: zod_1.z.string().optional().nullable(),
    onboardingMode: zod_1.z.enum(['connect_existing', 'create_demo']).optional().nullable(),
    ctraderAccountId: zod_1.z.string().optional().nullable(),
    ctraderConnectionKey: zod_1.z.string().optional().nullable(),
    saxoAccountKey: zod_1.z.string().optional().nullable(),
    saxoConnectionKey: zod_1.z.string().optional().nullable(),
    saxoEnvironment: zod_1.z.enum(['sim', 'live']).optional().nullable(),
    accountType: zod_1.z.enum(['demo', 'live', 'prop']),
    accountSubType: zod_1.z.enum(['live', 'demo', 'prop_challenge', 'funded']),
    sourceType: zod_1.z.enum(['manual', 'csv', 'mt4', 'mt5', 'ctrader', 'saxo', 'tradingview', 'broker_api', 'demo']),
    currency: zod_1.z.string().default('USD'),
    startingBalance: zod_1.z.number(),
    currentBalance: zod_1.z.number(),
    equity: zod_1.z.number(),
    leverage: zod_1.z.number().int().optional().nullable(),
    margin: zod_1.z.number().optional().nullable(),
    freeMargin: zod_1.z.number().optional().nullable(),
    lastConnectionError: zod_1.z.string().optional().nullable(),
    lastConnectionDetails: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional().nullable(),
    propFirmName: zod_1.z.string().optional().nullable(),
    maxDailyLossPercent: zod_1.z.number().optional().nullable(),
    maxTotalDrawdownPercent: zod_1.z.number().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
    autoJournalingEnabled: zod_1.z.boolean(),
    status: accountStatusSchema,
    connectedAt: zod_1.z.string().datetime().optional().nullable(),
    lastCheckedAt: zod_1.z.string().datetime().optional().nullable(),
    lastSyncAt: zod_1.z.string().datetime().optional().nullable(),
    totalImportedTrades: zod_1.z.number().int(),
    openPositions: zod_1.z.number().int(),
    todayPnl: zod_1.z.number(),
    weeklyPnl: zod_1.z.number(),
    closedTrades: zod_1.z.number().int().optional().nullable(),
    onboardingSummary: zod_1.z.string().optional().nullable(),
    autoHealingEnabled: zod_1.z.boolean().optional().nullable(),
    serviceDiagnostics: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional().nullable(),
    openTradesPreview: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).optional().nullable(),
    createdAt: zod_1.z.string().datetime(),
    updatedAt: zod_1.z.string().datetime(),
});
function toRow(account) {
    const row = {
        id: account.id,
        user_id: account.userId,
        name: account.name,
        broker: account.broker,
        platform: account.platform,
        metatrader_version: account.metatraderVersion ?? null,
        mt5_account_number: account.mt5AccountNumber ?? null,
        mt5_server: account.mt5Server ?? null,
        mt_connection_key: account.mtConnectionKey ?? null,
        ctrader_account_id: account.ctraderAccountId ?? null,
        ctrader_connection_key: account.ctraderConnectionKey ?? null,
        saxo_account_key: account.saxoAccountKey ?? null,
        saxo_connection_key: account.saxoConnectionKey ?? null,
        saxo_environment: account.saxoEnvironment ?? null,
        account_type: account.accountType,
        account_sub_type: account.accountSubType,
        source_type: account.sourceType,
        currency: account.currency,
        starting_balance: account.startingBalance,
        current_balance: account.currentBalance,
        equity: account.equity,
        leverage: account.leverage ?? null,
        last_connection_error: account.lastConnectionError ?? null,
        last_connection_details: account.lastConnectionDetails ?? null,
        prop_firm_name: account.propFirmName ?? null,
        max_daily_loss_percent: account.maxDailyLossPercent ?? null,
        max_total_drawdown_percent: account.maxTotalDrawdownPercent ?? null,
        notes: account.notes ?? null,
        auto_journaling_enabled: account.autoJournalingEnabled,
        status: account.status,
        last_checked_at: account.lastCheckedAt ?? null,
        last_sync_at: account.lastSyncAt ?? null,
        total_imported_trades: account.totalImportedTrades,
        open_positions: account.openPositions,
        today_pnl: account.todayPnl,
        weekly_pnl: account.weeklyPnl,
        open_trades_preview: account.openTradesPreview ?? null,
        created_at: account.createdAt,
        updated_at: account.updatedAt,
    };
    if (account.onboardingMode != null)
        row.onboarding_mode = account.onboardingMode;
    if (account.margin != null)
        row.margin = account.margin;
    if (account.freeMargin != null)
        row.free_margin = account.freeMargin;
    if (account.connectedAt != null)
        row.connected_at = account.connectedAt;
    if (account.closedTrades != null)
        row.closed_trades = account.closedTrades;
    if (account.onboardingSummary != null)
        row.onboarding_summary = account.onboardingSummary;
    if (account.autoHealingEnabled != null)
        row.auto_healing_enabled = account.autoHealingEnabled;
    if (account.serviceDiagnostics != null)
        row.service_diagnostics = account.serviceDiagnostics;
    return row;
}
function toResponse(row) {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        broker: row.broker,
        platform: row.platform,
        metatraderVersion: row.metatrader_version,
        mt5AccountNumber: row.mt5_account_number,
        mt5Server: row.mt5_server,
        mtConnectionKey: row.mt_connection_key,
        onboardingMode: row.onboarding_mode,
        ctraderAccountId: row.ctrader_account_id,
        ctraderConnectionKey: row.ctrader_connection_key,
        saxoAccountKey: row.saxo_account_key,
        saxoConnectionKey: row.saxo_connection_key,
        saxoEnvironment: row.saxo_environment,
        accountType: row.account_type,
        accountSubType: row.account_sub_type,
        sourceType: row.source_type,
        currency: row.currency,
        startingBalance: Number(row.starting_balance ?? 0),
        currentBalance: Number(row.current_balance ?? 0),
        equity: Number(row.equity ?? 0),
        leverage: typeof row.leverage === 'number' ? row.leverage : row.leverage ? Number(row.leverage) : undefined,
        margin: typeof row.margin === 'number' ? row.margin : row.margin ? Number(row.margin) : null,
        freeMargin: typeof row.free_margin === 'number' ? row.free_margin : row.free_margin ? Number(row.free_margin) : null,
        lastConnectionError: row.last_connection_error,
        lastConnectionDetails: row.last_connection_details,
        propFirmName: row.prop_firm_name,
        maxDailyLossPercent: row.max_daily_loss_percent ? Number(row.max_daily_loss_percent) : undefined,
        maxTotalDrawdownPercent: row.max_total_drawdown_percent ? Number(row.max_total_drawdown_percent) : undefined,
        notes: row.notes,
        autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
        status: row.status,
        connectedAt: row.connected_at,
        lastCheckedAt: row.last_checked_at,
        lastSyncAt: row.last_sync_at,
        totalImportedTrades: Number(row.total_imported_trades ?? 0),
        openPositions: Number(row.open_positions ?? 0),
        todayPnl: Number(row.today_pnl ?? 0),
        weeklyPnl: Number(row.weekly_pnl ?? 0),
        closedTrades: row.closed_trades != null ? Number(row.closed_trades) : undefined,
        onboardingSummary: typeof row.onboarding_summary === 'string' ? row.onboarding_summary : undefined,
        autoHealingEnabled: row.auto_healing_enabled == null ? undefined : Boolean(row.auto_healing_enabled),
        serviceDiagnostics: row.service_diagnostics,
        openTradesPreview: row.open_trades_preview,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
exports.tradingAccountsRouter.get('/', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        res.status(400).json({ error: 'userId required' });
        return;
    }
    const { data, error } = await supabase_js_1.supabase
        .from('trading_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json((data ?? []).map((row) => toResponse(row)));
});
exports.tradingAccountsRouter.post('/', async (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const { data, error } = await supabase_js_1.supabase
        .from('trading_accounts')
        .upsert(toRow(parsed.data), { onConflict: 'id' })
        .select('*')
        .single();
    if (error || !data) {
        res.status(500).json({ error: error?.message ?? 'Failed to save trading account.' });
        return;
    }
    res.json(toResponse(data));
});
exports.tradingAccountsRouter.patch('/:accountId', async (req, res) => {
    const parsed = accountSchema.partial().safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const row = toRow({
        id: req.params.accountId,
        userId: parsed.data.userId ?? '',
        name: parsed.data.name ?? '',
        broker: parsed.data.broker ?? '',
        platform: parsed.data.platform ?? '',
        metatraderVersion: parsed.data.metatraderVersion,
        mt5AccountNumber: parsed.data.mt5AccountNumber,
        mt5Server: parsed.data.mt5Server,
        mtConnectionKey: parsed.data.mtConnectionKey,
        onboardingMode: parsed.data.onboardingMode,
        ctraderAccountId: parsed.data.ctraderAccountId,
        ctraderConnectionKey: parsed.data.ctraderConnectionKey,
        saxoAccountKey: parsed.data.saxoAccountKey,
        saxoConnectionKey: parsed.data.saxoConnectionKey,
        saxoEnvironment: parsed.data.saxoEnvironment,
        accountType: parsed.data.accountType ?? 'live',
        accountSubType: parsed.data.accountSubType ?? 'live',
        sourceType: parsed.data.sourceType ?? 'manual',
        currency: parsed.data.currency ?? 'USD',
        startingBalance: parsed.data.startingBalance ?? 0,
        currentBalance: parsed.data.currentBalance ?? 0,
        equity: parsed.data.equity ?? 0,
        leverage: parsed.data.leverage,
        margin: parsed.data.margin,
        freeMargin: parsed.data.freeMargin,
        lastConnectionError: parsed.data.lastConnectionError,
        lastConnectionDetails: parsed.data.lastConnectionDetails,
        propFirmName: parsed.data.propFirmName,
        maxDailyLossPercent: parsed.data.maxDailyLossPercent,
        maxTotalDrawdownPercent: parsed.data.maxTotalDrawdownPercent,
        notes: parsed.data.notes,
        autoJournalingEnabled: parsed.data.autoJournalingEnabled ?? false,
        status: parsed.data.status ?? 'pending',
        connectedAt: parsed.data.connectedAt,
        lastCheckedAt: parsed.data.lastCheckedAt,
        lastSyncAt: parsed.data.lastSyncAt,
        totalImportedTrades: parsed.data.totalImportedTrades ?? 0,
        openPositions: parsed.data.openPositions ?? 0,
        todayPnl: parsed.data.todayPnl ?? 0,
        weeklyPnl: parsed.data.weeklyPnl ?? 0,
        closedTrades: parsed.data.closedTrades,
        onboardingSummary: parsed.data.onboardingSummary,
        autoHealingEnabled: parsed.data.autoHealingEnabled,
        serviceDiagnostics: parsed.data.serviceDiagnostics,
        openTradesPreview: parsed.data.openTradesPreview,
        createdAt: parsed.data.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.data.updatedAt ?? new Date().toISOString(),
    });
    const updates = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value !== undefined));
    delete updates.id;
    delete updates.created_at;
    const { data, error } = await supabase_js_1.supabase
        .from('trading_accounts')
        .update(updates)
        .eq('id', req.params.accountId)
        .select('*')
        .single();
    if (error || !data) {
        res.status(500).json({ error: error?.message ?? 'Failed to update trading account.' });
        return;
    }
    res.json(toResponse(data));
});
exports.tradingAccountsRouter.delete('/:accountId', async (req, res) => {
    const { error } = await supabase_js_1.supabase.from('trading_accounts').delete().eq('id', req.params.accountId);
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json({ success: true });
});
