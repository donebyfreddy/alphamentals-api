import { execute, db, getDatabaseUrlDiagnostics } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';
import type { MetaTraderAccountSnapshot, MetaTraderConnectResult, MetaTraderCredentials } from './metaTrader.service.js';
import { connectMetaTrader, getBridgeStatus } from './metaTrader.service.js';
import { createNotification } from './notification.service.js';
import { decryptPassword, isEncryptionConfigured } from '../lib/credentialEncryption.js';
import {
  buildTradeAnalysis,
  normalizeClosedTrades,
  normalizeOpenPositions,
  type NormalizedMt5ClosedTrade,
  type NormalizedMt5OpenTrade,
} from './mt5Sync.helpers.js';

type LinkedMt5Account = {
  id: string;
  userId: string;
  brokerName: string;
  accountLogin: string;
  serverName: string;
  accountType: string;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
};

export interface Mt5SyncResult {
  success: boolean;
  accountId: string | null;
  accountLogin: string | null;
  fetchedOpenPositions: number;
  fetchedClosedTrades: number;
  journalEntriesCreated: number;
  journalEntriesUpdated: number;
  recentTradesAvailable: number;
  lastSyncTime: string | null;
  errors: string[];
}

export interface Mt5StatusResult {
  apiReachable: boolean;
  linkedAccountExists: boolean;
  lastSyncTime: string | null;
  openTrades: number;
  closedTradesSynced: number;
  journalTradesSynced: number;
  lastError: string | null;
  accountLogin: string | null;
  serverName: string | null;
}

type JournalTradeRow = {
  id: string;
};

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? null;
const AUTO_SYNC_INTERVAL_MS = Number(process.env.MT5_AUTO_SYNC_INTERVAL_MS ?? 60_000);

let syncInFlight: Promise<Mt5SyncResult> | null = null;
let lastSyncError: string | null = null;

// ── No-spam throttle ──────────────────────────────────────────────────────────
const _spamThrottle = new Map<string, number>();
const SPAM_INTERVAL_MS = 5 * 60 * 1000;
let _noAccountsLoggedOnce = false;
let _dbConfigWarningLoggedOnce = false;

function throttledLog(key: string, level: 'log' | 'warn' | 'error', message: string, ...args: unknown[]) {
  const now = Date.now();
  const last = _spamThrottle.get(key) ?? 0;
  if (now - last < SPAM_INTERVAL_MS) return;
  _spamThrottle.set(key, now);
  console[level](message, ...args);
}

function humanizeMt5SyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Can't reach database server")) {
    return 'Trade journal database is unavailable. Check your Supabase/DB connection before syncing MT5 trades.';
  }
  if (message.toLowerCase().includes('connection timeout')) {
    return 'MT5 connection timed out while fetching account data.';
  }
  return message;
}

// ── Load syncable accounts from DB ───────────────────────────────────────────

interface SyncableAccount {
  id: string;
  name: string;
  mt5_account_number: string | null;
  mt5_server: string | null;
  account_type: string;
  connection_mode: string | null;
  encrypted_password: Record<string, string> | null;
  user_id: string | null;
  auto_journaling_enabled: boolean;
  trading_enabled: boolean;
}

async function loadSyncableAccounts(): Promise<SyncableAccount[]> {
  try {
    if (db) {
      const result = await db.query<SyncableAccount>(
        `SELECT id, name, mt5_account_number, mt5_server, account_type,
                connection_mode, encrypted_password, user_id,
                auto_journaling_enabled, trading_enabled
           FROM trading_accounts
          WHERE platform = 'MT5'
            AND status IN ('connected', 'trading_enabled', 'read_only', 'syncing')
            AND encrypted_password IS NOT NULL`,
      );
      return result.rows;
    }
    const { data } = await supabase
      .from('trading_accounts')
      .select('id, name, mt5_account_number, mt5_server, account_type, connection_mode, encrypted_password, user_id, auto_journaling_enabled, trading_enabled')
      .eq('platform', 'MT5')
      .in('status', ['connected', 'trading_enabled', 'read_only', 'syncing'])
      .not('encrypted_password', 'is', null);
    return (data ?? []) as SyncableAccount[];
  } catch (err) {
    if (!_dbConfigWarningLoggedOnce) {
      _dbConfigWarningLoggedOnce = true;
      console.warn('[MT5 Sync] Could not query trading_accounts for sync. Direct DATABASE_URL failed; using Supabase service role fallback.', (err as Error).message);
    }
    return [];
  }
}

function buildCredentialsFromAccount(account: SyncableAccount, plainPassword: string): MetaTraderCredentials {
  const connectionMode = account.connection_mode ?? 'read_only';
  const passwordType: 'master' | 'investor' = connectionMode === 'trading' ? 'master' : 'investor';
  return {
    version: 'mt5',
    login: account.mt5_account_number ?? '',
    password: plainPassword,
    server: account.mt5_server ?? '',
    accountType: (account.account_type as 'demo' | 'live') ?? 'demo',
    passwordType,
  };
}

// ── Core sync logic ───────────────────────────────────────────────────────────

function mapAccountRow(row: Record<string, unknown>): LinkedMt5Account {
  return {
    id: String(row.id),
    userId: String(row.userId ?? row.user_id ?? ''),
    brokerName: String(row.brokerName ?? row.broker_name ?? ''),
    accountLogin: String(row.accountLogin ?? row.account_login ?? ''),
    serverName: String(row.serverName ?? row.server_name ?? ''),
    accountType: String(row.accountType ?? row.account_type ?? ''),
    status: String(row.status ?? ''),
    lastSyncedAt: row.lastSyncedAt ? String(row.lastSyncedAt) : row.last_synced_at ? String(row.last_synced_at) : null,
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
  };
}

async function ensureTradeImportColumns() {
  try {
    await execute(`
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
    await execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS trades_user_source_external_trade_uidx
      ON trades ("userId", "importSource", "externalTradeId")
      WHERE "externalTradeId" IS NOT NULL AND "importSource" IS NOT NULL;
    `);
  } catch (err) {
    if (!_dbConfigWarningLoggedOnce) {
      _dbConfigWarningLoggedOnce = true;
      const diagnostics = getDatabaseUrlDiagnostics();
      console.warn('[MT5 Sync] Could not ensure trade import columns (safe to ignore if table was pre-created by migration). Direct DATABASE_URL failed; using Supabase service role fallback.', {
        code: diagnostics.issueCode ?? 'DATABASE_CONFIG_INVALID',
        hostname: diagnostics.hostname,
      });
    }
  }
}

async function getOrCreateLinkedAccount(userId: string, account: MetaTraderAccountSnapshot, credentials: MetaTraderCredentials): Promise<LinkedMt5Account> {
  const payload = {
    userId,
    brokerName: account.broker || credentials.server,
    accountLogin: account.login,
    serverName: account.server,
    accountType: credentials.accountType,
    status: 'connected',
    lastSyncedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('mt5_connected_accounts')
    .upsert(payload, { onConflict: 'userId,accountLogin,serverName' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to persist linked MT5 account.');
  }

  return mapAccountRow(data as Record<string, unknown>);
}

async function replaceOpenPositions(account: LinkedMt5Account, openTrades: NormalizedMt5OpenTrade[]) {
  await supabase.from('mt5_open_positions').delete().eq('accountId', account.id);

  if (!openTrades.length) return;

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

  const { error } = await supabase.from('mt5_open_positions').insert(rows);
  if (error) throw new Error(error.message);
}

async function upsertMt5TradeRows(account: LinkedMt5Account, closedTrades: NormalizedMt5ClosedTrade[]) {
  if (!closedTrades.length) return;

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

  const { error } = await supabase
    .from('mt5_trades')
    .upsert(rows, { onConflict: 'accountId,ticket' });

  if (error) throw new Error(error.message);
}

async function insertEquitySnapshot(account: LinkedMt5Account, snapshot: MetaTraderAccountSnapshot) {
  const { error } = await supabase.from('mt5_equity_snapshots').insert({
    userId: account.userId,
    accountId: account.id,
    balance: snapshot.balance,
    equity: snapshot.equity,
    drawdown: snapshot.balance > 0 ? Number((((snapshot.balance - snapshot.equity) / snapshot.balance) * 100).toFixed(3)) : null,
  });

  if (error) throw new Error(error.message);
}

function tradeTags(symbol: string, status: 'OPEN' | 'CLOSED'): string[] {
  return ['MT5', 'AUTO_IMPORTED', status, symbol].filter(Boolean);
}

async function upsertJournalTrade(params: {
  account: LinkedMt5Account;
  mt5Trade: NormalizedMt5ClosedTrade | NormalizedMt5OpenTrade;
  accountSnapshot: MetaTraderAccountSnapshot;
  status: 'OPEN' | 'CLOSED';
  externalOrderId?: string | null;
  externalPositionId?: string | null;
}): Promise<'created' | 'updated'> {
  const isClosedTrade = (
    t: NormalizedMt5ClosedTrade | NormalizedMt5OpenTrade,
  ): t is NormalizedMt5ClosedTrade => 'closePrice' in t;
  const closePrice = isClosedTrade(params.mt5Trade) ? params.mt5Trade.closePrice : null;
  const closeTime = isClosedTrade(params.mt5Trade) ? params.mt5Trade.closeTime : null;
  const analysis = buildTradeAnalysis({
    symbol: params.mt5Trade.symbol,
    direction: params.mt5Trade.direction,
    entryPrice: params.mt5Trade.entryPrice,
    closePrice,
    profit: params.mt5Trade.profit,
    openTime: params.mt5Trade.openTime,
    closeTime,
    account: params.accountSnapshot,
  });

  const existingQuery = await supabase
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
    const { error } = await supabase.from('trades').update(marketUpdate).eq('id', (existingQuery.data as JournalTradeRow).id);
    if (error) throw new Error(error.message);
    return 'updated';
  }

  const nextTradeNumber = await supabase
    .from('trades')
    .select('tradeNumber')
    .eq('userId', params.account.userId)
    .order('tradeNumber', { ascending: false })
    .limit(1)
    .maybeSingle();

  const tradeNumber = Number((nextTradeNumber.data as { tradeNumber?: number } | null)?.tradeNumber ?? 0) + 1;

  const { error } = await supabase.from('trades').insert({ ...payload, tradeNumber });
  if (error) throw new Error(error.message);
  return 'created';
}

async function syncJournalTrades(account: LinkedMt5Account, accountSnapshot: MetaTraderAccountSnapshot, openTrades: NormalizedMt5OpenTrade[], closedTrades: NormalizedMt5ClosedTrade[]) {
  let created = 0;
  let updated = 0;

  for (const trade of openTrades) {
    const result = await upsertJournalTrade({ account, mt5Trade: trade, accountSnapshot, status: 'OPEN' });
    if (result === 'created') created++;
    else updated++;
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
    if (result === 'created') created++;
    else updated++;
  }

  return { created, updated };
}

function assertSyncReady(result: MetaTraderConnectResult): asserts result is MetaTraderConnectResult & { account: MetaTraderAccountSnapshot } {
  if (!result.success || !result.account) {
    throw new Error(result.error?.message ?? 'MT5 sync failed to retrieve account data.');
  }
}

async function performMt5Sync(credentials: MetaTraderCredentials, effectiveUserId: string): Promise<Mt5SyncResult> {
  if (!credentials.login || !credentials.server) {
    return {
      success: false,
      accountId: null,
      accountLogin: credentials.login || null,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ['MT5 account login or server is missing. Skipping sync.'],
    };
  }

  console.log(`[MT5 Sync] Starting sync for account ${credentials.login} on server ${credentials.server}`);
  await ensureTradeImportColumns();
  const result = await connectMetaTrader(credentials);

  if (!result.success) {
    const errCode = result.error?.code ?? 'UNKNOWN';
    const errMsg = result.error?.message ?? 'MT5 bridge connection failed.';
    // Structured log — never [object Object]
    const details = result.error?.details;
    throttledLog(
      `mt5-sync-fail-${credentials.login}`,
      'error',
      `[MT5 Sync] Local bridge connection failed. code=${errCode} message=${errMsg}`,
      details ? { details } : undefined,
    );
    throw new Error(`MT5 sync failed [${errCode}]: ${errMsg}`);
  }
  if (!result.account) throw new Error('MT5 bridge returned success but no account snapshot — unexpected response.');

  const linkedAccount = await getOrCreateLinkedAccount(effectiveUserId, result.account, credentials);
  const openTrades = normalizeOpenPositions(result.positions ?? []);
  const closedTrades = normalizeClosedTrades(result.history ?? []);

  console.log(`[MT5 Sync] Open positions fetched: ${openTrades.length}`);
  console.log(`[MT5 Sync] Closed trades fetched: ${closedTrades.length}`);

  await Promise.all([
    replaceOpenPositions(linkedAccount, openTrades),
    upsertMt5TradeRows(linkedAccount, closedTrades),
    insertEquitySnapshot(linkedAccount, result.account),
  ]);

  const journal = await syncJournalTrades(linkedAccount, result.account, openTrades, closedTrades);
  console.log(`[MT5 Sync] Journal entries created: ${journal.created}, updated: ${journal.updated}`);

  const syncTime = new Date().toISOString();
  const { error: accountUpdateError } = await supabase
    .from('mt5_connected_accounts')
    .update({ status: 'connected', lastSyncedAt: syncTime })
    .eq('id', linkedAccount.id);

  if (accountUpdateError) throw new Error(accountUpdateError.message);

  const recentTrades = await getRecentTrades(5);
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

// ── Public sync API ───────────────────────────────────────────────────────────

export async function syncMt5AccountNow(): Promise<Mt5SyncResult> {
  const accounts = await loadSyncableAccounts();

  if (accounts.length === 0) {
    if (!_noAccountsLoggedOnce) {
      _noAccountsLoggedOnce = true;
      console.log('[MT5 Sync] No MT5 accounts configured. Add an account from the Accounts page to start syncing.');
    }
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
      errors: ['No MT5 accounts configured.'],
    };
  }

  // Sync first eligible account (the primary account)
  const account = accounts[0];

  if (!account.mt5_account_number || !account.mt5_server) {
    return {
      success: false,
      accountId: account.id,
      accountLogin: account.mt5_account_number ?? null,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ['Account is missing login or server. Skipping.'],
    };
  }

  if (!isEncryptionConfigured() || !account.encrypted_password) {
    throttledLog(`mt5-no-creds-${account.id}`, 'warn', `[MT5 Sync] Account ${account.id} has no stored credentials. Reconnect via the Accounts page.`);
    return {
      success: false,
      accountId: account.id,
      accountLogin: account.mt5_account_number,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ['No stored credentials. Reconnect this account from the Accounts page.'],
    };
  }

  let plainPassword: string;
  try {
    plainPassword = decryptPassword(account.encrypted_password as { ciphertext: string; iv: string; tag: string; algorithm: string });
  } catch (err) {
    throttledLog(`mt5-decrypt-fail-${account.id}`, 'error', `[MT5 Sync] Could not decrypt credentials for account ${account.id}:`, (err as Error).message);
    return {
      success: false,
      accountId: account.id,
      accountLogin: account.mt5_account_number,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ['Credential decryption failed. Reconnect this account from the Accounts page.'],
    };
  }

  const credentials = buildCredentialsFromAccount(account, plainPassword);
  const effectiveUserId = account.user_id ?? DEFAULT_USER_ID;
  if (!effectiveUserId) {
    return {
      success: false,
      accountId: account.id,
      accountLogin: account.mt5_account_number,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ['DEFAULT_USER_ID is not configured. Set it in .env.'],
    };
  }

  if (syncInFlight !== null) return syncInFlight;

  syncInFlight = performMt5Sync(credentials, effectiveUserId)
    .catch((error: unknown) => {
      const message = humanizeMt5SyncError(error);
      lastSyncError = message;
      void createNotification({
        title: 'MT5 account sync failed',
        message,
        category: 'account_sync',
        severity: 'critical',
        source: 'mt5_sync',
        metadata: { accountLogin: account.mt5_account_number },
        dedupeKey: 'mt5-sync-failure',
      });
      return {
        success: false,
        accountId: account.id,
        accountLogin: account.mt5_account_number,
        fetchedOpenPositions: 0,
        fetchedClosedTrades: 0,
        journalEntriesCreated: 0,
        journalEntriesUpdated: 0,
        recentTradesAvailable: 0,
        lastSyncTime: null,
        errors: [message],
      } satisfies Mt5SyncResult;
    })
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}

export async function getMt5Status(): Promise<Mt5StatusResult> {
  await ensureTradeImportColumns();
  const bridge = getBridgeStatus();

  const accounts = await loadSyncableAccounts();
  const primaryAccount = accounts[0] ?? null;

  const { data: accountRow } = primaryAccount
    ? await supabase
        .from('mt5_connected_accounts')
        .select('*')
        .eq('accountLogin', primaryAccount.mt5_account_number)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const account = accountRow ? mapAccountRow(accountRow as Record<string, unknown>) : null;
  const openTrades = account
    ? await supabase.from('mt5_open_positions').select('id', { count: 'exact', head: true }).eq('accountId', account.id)
    : { count: 0 };
  const closedTrades = account
    ? await supabase.from('mt5_trades').select('id', { count: 'exact', head: true }).eq('accountId', account.id)
    : { count: 0 };
  const userId = primaryAccount?.user_id ?? DEFAULT_USER_ID;
  const journalTrades = userId
    ? await supabase.from('trades').select('id', { count: 'exact', head: true }).eq('userId', userId).eq('importSource', 'MT5')
    : { count: 0 };

  return {
    apiReachable: bridge.configured && bridge.ready,
    linkedAccountExists: Boolean(account),
    lastSyncTime: account?.lastSyncedAt ?? null,
    openTrades: openTrades.count ?? 0,
    closedTradesSynced: closedTrades.count ?? 0,
    journalTradesSynced: journalTrades.count ?? 0,
    lastError: lastSyncError,
    accountLogin: account?.accountLogin ?? primaryAccount?.mt5_account_number ?? null,
    serverName: account?.serverName ?? primaryAccount?.mt5_server ?? null,
  };
}

export async function getRecentTrades(limit = 5) {
  await ensureTradeImportColumns();
  const userId = DEFAULT_USER_ID;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('userId', userId)
    .eq('importSource', 'MT5')
    .order('entryTime', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

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

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function scheduleAutomaticMt5Sync() {
  if (!DEFAULT_USER_ID) {
    console.warn('[MT5 Sync] DEFAULT_USER_ID not set — automatic MT5 sync disabled.');
    return;
  }

  console.log(`[MT5 Sync] Scheduler started. Will sync DB-configured MT5 accounts every ${AUTO_SYNC_INTERVAL_MS / 1000}s.`);
  console.log('[MT5 Sync] Accounts are loaded from the database — not from MT5_LOGIN/MT5_SERVER env vars.');

  setImmediate(() => { void syncMt5AccountNow(); });
  setInterval(() => { void syncMt5AccountNow(); }, AUTO_SYNC_INTERVAL_MS);
}
