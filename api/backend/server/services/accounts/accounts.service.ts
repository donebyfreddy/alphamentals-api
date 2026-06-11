import crypto from 'node:crypto';
import { supabase } from '../../lib/supabase.js';
import { db } from '../../lib/db.js';
import { encryptPassword, decryptPassword, isEncryptionConfigured } from '../../lib/credentialEncryption.js';
import { validateRiskConfig, type RiskConfig } from '../../lib/riskValidation.js';
import {
  checkBridgeHealth,
  bridgeConnectAccount,
  bridgeGetAccountStatus,
  bridgeReconnectAccount,
  bridgeDisconnectAccount,
  bridgeVerifyTrading,
  bridgeGetPositions,
  bridgeGetOrders,
  bridgeGetDeals,
  type BridgeDiagnostics,
} from './accountsMt5Bridge.service.js';

export type AccountStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'read_only'
  | 'trading_enabled'
  | 'disconnected'
  | 'error'
  | 'vps_unreachable'
  | 'terminal_not_running'
  | 'login_failed'
  | 'trading_not_allowed'
  | 'syncing';

export interface ConnectAccountPayload {
  accountLabel: string;
  brokerName: string;
  platform: string;
  accountType: 'demo' | 'live';
  connectionMode: 'read_only' | 'trading';
  login: string;
  password: string;
  server: string;
  vpsTarget: string;
  autoJournalingEnabled?: boolean;
  tradingEnabled?: boolean;
  liveTradingConfirmed?: boolean;
  risk?: RiskConfig;
  userId?: string;
}

export interface AccountRow {
  id: string;
  user_id: string | null;
  name: string;
  broker: string;
  platform: string;
  metatrader_version: string | null;
  mt5_account_number: string | null;
  mt5_server: string | null;
  account_type: string;
  account_sub_type: string;
  source_type: string;
  currency: string | null;
  current_balance: number | null;
  equity: number | null;
  leverage: number | null;
  margin: number | null;
  free_margin: number | null;
  auto_journaling_enabled: boolean;
  status: string;
  connected_at: string | null;
  last_sync_at: string | null;
  last_connection_error: string | null;
  last_connection_details: Record<string, unknown> | null;
  service_diagnostics: Record<string, unknown> | null;
  starting_balance: number | null;
  total_imported_trades: number;
  open_positions: number;
  today_pnl: number;
  weekly_pnl: number;
  created_at: string;
  updated_at: string;
  // new columns (added by migration)
  connection_mode: string | null;
  encrypted_password: Record<string, string> | null;
  vps_target: string | null;
  trading_enabled: boolean;
  last_error_code: string | null;
  risk: RiskConfig | null;
  diagnostics: Record<string, unknown> | null;
}

export interface AccountResponse {
  id: string;
  accountLabel: string;
  brokerName: string;
  platform: string;
  accountType: string;
  connectionMode: string;
  login: string | null;
  server: string | null;
  vpsTarget: string | null;
  tradingEnabled: boolean;
  autoJournalingEnabled: boolean;
  status: string;
  balance: number | null;
  equity: number | null;
  margin: number | null;
  freeMargin: number | null;
  currency: string | null;
  leverage: string | null;
  lastConnectedAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  risk: RiskConfig | null;
  diagnostics: Record<string, unknown> | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceResult<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
  diagnostics?: Partial<BridgeDiagnostics>;
}

function rowToResponse(row: AccountRow): AccountResponse {
  return {
    id: row.id,
    accountLabel: row.name,
    brokerName: row.broker,
    platform: row.platform,
    accountType: row.account_type,
    connectionMode: row.connection_mode ?? 'read_only',
    login: row.mt5_account_number,
    server: row.mt5_server,
    vpsTarget: row.vps_target,
    tradingEnabled: Boolean(row.trading_enabled),
    autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
    status: row.status,
    balance: row.current_balance != null ? Number(row.current_balance) : null,
    equity: row.equity != null ? Number(row.equity) : null,
    margin: row.margin != null ? Number(row.margin) : null,
    freeMargin: row.free_margin != null ? Number(row.free_margin) : null,
    currency: row.currency ?? null,
    leverage: row.leverage != null ? String(row.leverage) : null,
    lastConnectedAt: row.connected_at,
    lastSyncedAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_connection_error,
    risk: row.risk,
    diagnostics: row.diagnostics ?? row.service_diagnostics,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertAccount(fields: Partial<AccountRow> & { id: string }): Promise<AccountRow | null> {
  const now = new Date().toISOString();
  const record = { updated_at: now, ...fields };

  if (db) {
    const keys = Object.keys(record);
    const values = Object.values(record);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const conflictClauses = keys
      .filter((k) => k !== 'id')
      .map((k, i) => `${k} = EXCLUDED.${k}`)
      .join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `
      INSERT INTO trading_accounts (${keys.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET ${conflictClauses}
      RETURNING *
    `;
    try {
      const result = await db.query<AccountRow>(sql, values);
      return result.rows[0] ?? null;
    } catch (err) {
      console.warn('[accounts] pg upsert failed, falling back to supabase:', (err as Error).message);
    }
  }

  const { data, error } = await supabase
    .from('trading_accounts')
    .upsert(record, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    console.error('[accounts] supabase upsert failed:', error.message);
    return null;
  }
  return data as AccountRow;
}

async function getAccountById(accountId: string): Promise<AccountRow | null> {
  if (db) {
    try {
      const result = await db.query<AccountRow>('SELECT * FROM trading_accounts WHERE id = $1', [accountId]);
      return result.rows[0] ?? null;
    } catch (err) {
      console.warn('[accounts] pg getById failed, falling back to supabase:', (err as Error).message);
    }
  }

  const { data } = await supabase.from('trading_accounts').select('*').eq('id', accountId).single();
  return (data as AccountRow) ?? null;
}

// ─── Connect ─────────────────────────────────────────────────────────────────

export async function connectAccount(payload: ConnectAccountPayload): Promise<ServiceResult<{ account: AccountResponse; diagnostics: Partial<BridgeDiagnostics> }>> {
  const {
    accountLabel,
    brokerName,
    platform,
    accountType,
    server,
    vpsTarget,
    login,
    password,
    autoJournalingEnabled = true,
    liveTradingConfirmed,
    userId,
  } = payload;

  let { connectionMode, tradingEnabled = false, risk } = payload;

  console.log('[Accounts] connect request received', {
    accountLabel,
    brokerName,
    platform,
    accountType,
    connectionMode,
    login,
    server,
    vpsTarget,
    tradingEnabled,
    autoJournalingEnabled,
  });

  // ── Validation ──────────────────────────────────────────────────────────────
  console.log('[Accounts] validation_started');

  const missing: string[] = [];
  if (!accountLabel) missing.push('accountLabel');
  if (!brokerName) missing.push('brokerName');
  if (!login) missing.push('login');
  if (!password) missing.push('password');
  if (!server) missing.push('server');
  if (!vpsTarget) missing.push('vpsTarget');
  if (missing.length > 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `Missing required fields: ${missing.join(', ')}` };
  }

  if (platform !== 'MT5') {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'platform must be MT5' };
  }
  if (!['demo', 'live'].includes(accountType)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'accountType must be demo or live' };
  }
  if (!['read_only', 'trading'].includes(connectionMode)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'connectionMode must be read_only or trading' };
  }

  if (connectionMode === 'read_only') {
    tradingEnabled = false;
  }

  if (accountType === 'live' && connectionMode === 'trading') {
    if (!liveTradingConfirmed) {
      return {
        ok: false,
        code: 'LIVE_TRADING_CONFIRMATION_REQUIRED',
        message: 'Live trading requires liveTradingConfirmed: true in the request body',
      };
    }
    if (process.env.ACCOUNTS_ALLOW_LIVE_TRADING === 'false') {
      return {
        ok: false,
        code: 'LIVE_TRADING_CONFIRMATION_REQUIRED',
        message: 'Live trading is disabled on this server (ACCOUNTS_ALLOW_LIVE_TRADING=false)',
      };
    }
  }

  const riskResult = validateRiskConfig(risk, tradingEnabled);
  if (!riskResult.valid) {
    return { ok: false, code: 'RISK_CONFIG_INVALID', message: riskResult.errors.join('; ') };
  }
  risk = riskResult.normalized;

  // ── Encryption key check ────────────────────────────────────────────────────
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      code: 'ENCRYPTION_KEY_MISSING',
      message: 'ACCOUNT_CREDENTIALS_ENCRYPTION_KEY is not configured on the server',
    };
  }

  // ── Bridge health ───────────────────────────────────────────────────────────
  console.log('[Accounts] bridge_health_checked');
  const healthCheck = await checkBridgeHealth();
  if (!healthCheck.healthy) {
    console.error('[Accounts] bridge unreachable:', healthCheck.details);
    return {
      ok: false,
      code: 'VPS_UNREACHABLE',
      message: `MT5 bridge is unreachable. ${String(healthCheck.details ?? '')}`.trim(),
      diagnostics: { bridgeHealthy: false },
    };
  }

  // ── Encrypt password ────────────────────────────────────────────────────────
  console.log('[Accounts] credentials_encrypted');
  let encryptedPassword: ReturnType<typeof encryptPassword>;
  try {
    encryptedPassword = encryptPassword(password);
  } catch (err) {
    return { ok: false, code: 'ENCRYPTION_KEY_MISSING', message: (err as Error).message };
  }

  // ── Create/update account record ────────────────────────────────────────────
  console.log('[Accounts] db_record_created');
  const accountId = crypto.randomUUID();
  const effectiveUserId = userId ?? process.env.DEFAULT_USER_ID ?? null;
  const now = new Date().toISOString();

  const accountRow = await upsertAccount({
    id: accountId,
    user_id: effectiveUserId,
    name: accountLabel,
    broker: brokerName,
    platform,
    metatrader_version: 'mt5',
    mt5_account_number: login,
    mt5_server: server,
    account_type: accountType,
    account_sub_type: accountType === 'demo' ? 'demo' : 'live',
    source_type: 'mt5',
    connection_mode: connectionMode,
    encrypted_password: encryptedPassword as unknown as Record<string, string>,
    vps_target: vpsTarget,
    trading_enabled: tradingEnabled,
    auto_journaling_enabled: autoJournalingEnabled,
    status: 'connecting',
    risk: risk as RiskConfig,
    diagnostics: { bridgeHealthy: true },
    current_balance: 0,
    equity: 0,
    starting_balance: 0,
    total_imported_trades: 0,
    open_positions: 0,
    today_pnl: 0,
    weekly_pnl: 0,
    created_at: now,
    updated_at: now,
  });

  if (!accountRow) {
    return { ok: false, code: 'DATABASE_SAVE_FAILED', message: 'Failed to save account record to database' };
  }

  // ── Bridge connect ──────────────────────────────────────────────────────────
  console.log('[Accounts] bridge_connect_started');
  const bridgeResult = await bridgeConnectAccount({
    accountId,
    login,
    password,
    server,
    connectionMode,
    tradingEnabled,
    autoJournalingEnabled,
  });

  if (!bridgeResult.ok) {
    const errorCode = bridgeResult.errorCode ?? 'MT5_LOGIN_FAILED';
    const statusMap: Record<string, AccountStatus> = {
      MT5_LOGIN_FAILED: 'login_failed',
      MT5_TRADING_NOT_ALLOWED: 'trading_not_allowed',
      MT5_BRIDGE_UNAVAILABLE: 'vps_unreachable',
      VPS_UNREACHABLE: 'vps_unreachable',
    };
    const newStatus: AccountStatus = statusMap[errorCode] ?? 'error';

    await upsertAccount({
      id: accountId,
      status: newStatus,
      last_error_code: errorCode,
      last_connection_error: bridgeResult.errorMessage ?? null,
      diagnostics: bridgeResult.diagnostics as unknown as Record<string, unknown>,
    });

    console.error('[Accounts] connect_failed', { errorCode, message: bridgeResult.errorMessage });
    return {
      ok: false,
      code: errorCode,
      message: bridgeResult.errorMessage ?? 'MT5 connection failed',
      diagnostics: bridgeResult.diagnostics,
    };
  }

  // ── Update account with bridge result ───────────────────────────────────────
  console.log('[Accounts] mt5_login_verified');
  const info = bridgeResult.accountInfo ?? {};
  const tradingAllowed = bridgeResult.diagnostics.tradingAllowed;

  if (connectionMode === 'trading' && !tradingAllowed) {
    await upsertAccount({
      id: accountId,
      status: 'trading_not_allowed',
      last_error_code: 'MT5_INVESTOR_PASSWORD_ONLY',
      last_connection_error: 'The provided password does not allow trading. Use master/trading password.',
      diagnostics: bridgeResult.diagnostics as unknown as Record<string, unknown>,
    });
    console.error('[Accounts] trading_not_allowed', { accountId });
    return {
      ok: false,
      code: 'MT5_INVESTOR_PASSWORD_ONLY',
      message: 'Trading is not allowed. This may be an investor password or terminal trading is disabled.',
      diagnostics: bridgeResult.diagnostics,
    };
  }

  console.log('[Accounts] account_info_synced');
  const finalStatus: AccountStatus = connectionMode === 'trading' && tradingEnabled && tradingAllowed
    ? 'trading_enabled'
    : connectionMode === 'trading'
    ? 'connected'
    : 'read_only';

  const updatedRow = await upsertAccount({
    id: accountId,
    status: finalStatus,
    current_balance: info.balance ?? null,
    equity: info.equity ?? null,
    margin: info.margin ?? null,
    free_margin: info.freeMargin ?? null,
    currency: info.currency ?? null,
    leverage: info.leverage != null ? Number(info.leverage) : null,
    last_error_code: null,
    last_connection_error: null,
    connected_at: new Date().toISOString(),
    diagnostics: bridgeResult.diagnostics as unknown as Record<string, unknown>,
  });

  if (autoJournalingEnabled) {
    console.log('[Accounts] auto_journaling_started', { accountId });
  }

  console.log('[Accounts] connect_completed', { accountId, status: finalStatus });

  const finalRow = updatedRow ?? accountRow;
  return {
    ok: true,
    data: {
      account: rowToResponse(finalRow),
      diagnostics: bridgeResult.diagnostics,
    },
  };
}

// ─── List accounts ────────────────────────────────────────────────────────────

export async function listAccounts(userId?: string): Promise<AccountRow[]> {
  if (db) {
    try {
      const sql = userId
        ? 'SELECT * FROM trading_accounts WHERE user_id = $1 ORDER BY created_at DESC'
        : 'SELECT * FROM trading_accounts ORDER BY created_at DESC';
      const result = await db.query<AccountRow>(sql, userId ? [userId] : []);
      return result.rows;
    } catch (err) {
      console.warn('[accounts] pg listAccounts failed, falling back to supabase:', (err as Error).message);
    }
  }

  let query = supabase.from('trading_accounts').select('*').order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', userId);
  const { data } = await query;
  return (data ?? []) as AccountRow[];
}

export async function getAccount(accountId: string): Promise<ServiceResult<{ account: AccountResponse }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }
  return { ok: true, data: { account: rowToResponse(row) } };
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getAccountStatus(accountId: string): Promise<ServiceResult<Record<string, unknown>>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }

  const bridgeStatus = await bridgeGetAccountStatus(accountId);

  const result = {
    ok: true,
    accountId,
    status: bridgeStatus.ok ? (bridgeStatus.status ?? row.status) : row.status,
    connectionMode: row.connection_mode ?? 'read_only',
    tradingEnabled: Boolean(row.trading_enabled),
    autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
    lastSyncedAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_connection_error,
    diagnostics: bridgeStatus.diagnostics ?? row.diagnostics ?? {},
  };

  return { ok: true, data: result };
}

// ─── Reconnect ────────────────────────────────────────────────────────────────

export async function reconnectAccount(accountId: string): Promise<ServiceResult<{ account: AccountResponse; diagnostics: Partial<BridgeDiagnostics> }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }

  if (!row.encrypted_password) {
    return { ok: false, code: 'ENCRYPTION_KEY_MISSING', message: 'No stored credentials found for this account' };
  }

  if (!isEncryptionConfigured()) {
    return { ok: false, code: 'ENCRYPTION_KEY_MISSING', message: 'ACCOUNT_CREDENTIALS_ENCRYPTION_KEY is not configured' };
  }

  let decryptedPassword: string;
  try {
    decryptedPassword = decryptPassword(row.encrypted_password as { ciphertext: string; iv: string; tag: string; algorithm: string });
  } catch (err) {
    return { ok: false, code: 'ENCRYPTION_KEY_MISSING', message: `Credential decrypt failed: ${(err as Error).message}` };
  }

  await upsertAccount({ id: accountId, status: 'connecting' });

  const bridgeResult = await bridgeReconnectAccount(accountId, {
    accountId,
    login: row.mt5_account_number ?? '',
    password: decryptedPassword,
    server: row.mt5_server ?? '',
    connectionMode: (row.connection_mode as 'read_only' | 'trading') ?? 'read_only',
    tradingEnabled: Boolean(row.trading_enabled),
    autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
  });

  if (!bridgeResult.ok) {
    await upsertAccount({
      id: accountId,
      status: 'error',
      last_error_code: bridgeResult.errorCode ?? 'MT5_LOGIN_FAILED',
      last_connection_error: bridgeResult.errorMessage ?? null,
    });
    return { ok: false, code: bridgeResult.errorCode, message: bridgeResult.errorMessage, diagnostics: bridgeResult.diagnostics };
  }

  const info = bridgeResult.accountInfo ?? {};
  const finalStatus: AccountStatus = row.connection_mode === 'trading' && row.trading_enabled
    ? 'trading_enabled'
    : row.connection_mode === 'trading'
    ? 'connected'
    : 'read_only';

  const updatedRow = await upsertAccount({
    id: accountId,
    status: finalStatus,
    current_balance: info.balance ?? null,
    equity: info.equity ?? null,
    currency: info.currency ?? null,
    last_error_code: null,
    last_connection_error: null,
    connected_at: new Date().toISOString(),
    diagnostics: bridgeResult.diagnostics as unknown as Record<string, unknown>,
  });

  return {
    ok: true,
    data: {
      account: rowToResponse(updatedRow ?? row),
      diagnostics: bridgeResult.diagnostics,
    },
  };
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectAccount(accountId: string): Promise<ServiceResult<{ accountId: string }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }

  await bridgeDisconnectAccount(accountId);

  await upsertAccount({
    id: accountId,
    status: 'disconnected',
    last_error_code: null,
    last_connection_error: null,
  });

  return { ok: true, data: { accountId } };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAccount(accountId: string): Promise<ServiceResult<{ accountId: string }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }

  await bridgeDisconnectAccount(accountId).catch(() => undefined);

  if (db) {
    try {
      await db.query('DELETE FROM trading_accounts WHERE id = $1', [accountId]);
      return { ok: true, data: { accountId } };
    } catch (err) {
      console.warn('[accounts] pg delete failed, falling back to supabase:', (err as Error).message);
    }
  }

  const { error } = await supabase.from('trading_accounts').delete().eq('id', accountId);
  if (error) {
    return { ok: false, code: 'DATABASE_SAVE_FAILED', message: error.message };
  }
  return { ok: true, data: { accountId } };
}

// ─── Verify trading ───────────────────────────────────────────────────────────

export async function verifyAccountTrading(accountId: string): Promise<ServiceResult<{ tradingAllowed: boolean }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }
  if (row.connection_mode !== 'trading') {
    return { ok: false, code: 'TRADING_DISABLED', message: 'Account is in read_only mode. Trading is not allowed.' };
  }

  const result = await bridgeVerifyTrading(accountId);

  if (!result.tradingAllowed) {
    await upsertAccount({
      id: accountId,
      last_error_code: result.errorCode ?? 'MT5_TRADING_NOT_ALLOWED',
      last_connection_error: result.errorMessage ?? null,
    });
    return {
      ok: false,
      code: result.errorCode ?? 'MT5_TRADING_NOT_ALLOWED',
      message: result.errorMessage ?? 'Trading is not allowed. This may be an investor password or terminal trading is disabled.',
    };
  }

  await upsertAccount({ id: accountId, trading_enabled: true, status: 'trading_enabled' });
  return { ok: true, data: { tradingAllowed: true } };
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncAccount(accountId: string): Promise<ServiceResult<{ synced: boolean }>> {
  const row = await getAccountById(accountId);
  if (!row) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  }

  await upsertAccount({ id: accountId, status: 'syncing' });

  const [positions, orders, deals] = await Promise.all([
    bridgeGetPositions(accountId),
    bridgeGetOrders(accountId),
    bridgeGetDeals(accountId),
  ]);

  await upsertAccount({
    id: accountId,
    status: row.status === 'syncing' ? (row.connection_mode === 'trading' && row.trading_enabled ? 'trading_enabled' : row.connection_mode === 'trading' ? 'connected' : 'read_only') : row.status,
    open_positions: positions.length,
    last_sync_at: new Date().toISOString(),
  });

  return { ok: true, data: { synced: true } };
}

// ─── Positions / Orders / Deals ───────────────────────────────────────────────

export async function getAccountPositions(accountId: string): Promise<ServiceResult<unknown[]>> {
  const row = await getAccountById(accountId);
  if (!row) return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  const data = await bridgeGetPositions(accountId);
  return { ok: true, data };
}

export async function getAccountOrders(accountId: string): Promise<ServiceResult<unknown[]>> {
  const row = await getAccountById(accountId);
  if (!row) return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  const data = await bridgeGetOrders(accountId);
  return { ok: true, data };
}

export async function getAccountDeals(accountId: string): Promise<ServiceResult<unknown[]>> {
  const row = await getAccountById(accountId);
  if (!row) return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };
  const data = await bridgeGetDeals(accountId);
  return { ok: true, data };
}

// ─── Journal status ───────────────────────────────────────────────────────────

export async function getJournalStatus(accountId: string): Promise<ServiceResult<Record<string, unknown>>> {
  const row = await getAccountById(accountId);
  if (!row) return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found` };

  return {
    ok: true,
    data: {
      accountId,
      autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
      source: 'mt5',
      lastSyncedAt: row.last_sync_at,
      totalImportedTrades: row.total_imported_trades,
      openPositions: row.open_positions,
    },
  };
}

export { rowToResponse };
