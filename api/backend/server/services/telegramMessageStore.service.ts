import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import ws from 'ws';

const wsTransport = ws as unknown as WebSocketLikeConstructor;
import { checkDatabaseConnection, execute, isDatabaseConfigured, isDatabaseConnectionError, query } from '../lib/db.js';
import type { TelegramAttachmentMetadata, TelegramMessageRecord, TelegramReplyInfo } from '../types/telegram.js';
import type { ParsedTelegramSignal } from '../../../src/utils/telegram/parseTelegramSignal.js';

const TABLE = 'telegram_messages';

export type StorageStrategy = 'postgres_direct' | 'supabase_client' | 'unavailable';

// ── Supabase REST fallback ───────────────────────────────────────────────────
// The direct Postgres host can be unreachable while the Supabase REST endpoint
// still works. We never reconstruct or hardcode a DB hostname — we use whichever
// credential set the environment already provides (DATABASE_URL, else Supabase).
let supabaseClient: SupabaseClient | null | undefined;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) return supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    supabaseClient = null;
    return null;
  }
  supabaseClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: wsTransport } });
  return supabaseClient;
}

function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseClient());
}

let cachedStrategy: { value: StorageStrategy; at: number } | null = null;
const STRATEGY_TTL_MS = 30_000;

export function logDatabaseDiagnostics() {
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
  const publishable = Boolean(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  console.info(`[Database] DATABASE_URL configured: ${isDatabaseConfigured() ? 'yes' : 'no'}`);
  console.info(`[Database] SUPABASE_SERVICE_ROLE_KEY configured: ${serviceRole ? 'yes' : 'no'}`);
  console.info(`[Database] SUPABASE_PUBLISHABLE_KEY configured: ${publishable ? 'yes' : 'no'}`);
}

/** Decide once (cached) how to talk to the database: direct Postgres, Supabase REST, or neither. */
export async function resolveStorageStrategy(force = false): Promise<StorageStrategy> {
  if (!force && cachedStrategy && Date.now() - cachedStrategy.at < STRATEGY_TTL_MS) return cachedStrategy.value;

  logDatabaseDiagnostics();
  let value: StorageStrategy = 'unavailable';

  if (isDatabaseConfigured()) {
    const health = await checkDatabaseConnection();
    if (health.ok) {
      console.info('[Database] Using DATABASE_URL');
      value = 'postgres_direct';
    } else if (isSupabaseConfigured()) {
      console.warn('[Database] DATABASE_URL failed');
      console.warn('[Database] Falling back to Supabase service role client');
      value = 'supabase_client';
    }
  } else if (isSupabaseConfigured()) {
    value = 'supabase_client';
  }

  console.info(`[Database] Using database strategy: ${value}`);
  cachedStrategy = { value, at: Date.now() };
  return value;
}

function setStrategy(value: StorageStrategy) {
  cachedStrategy = { value, at: Date.now() };
}

type TelegramRow = {
  id: string;
  telegram_message_id: string;
  chat_id: string;
  chat_title: string | null;
  sender_id: string | null;
  sender_name: string | null;
  text: string;
  raw_text: string;
  reply_info: unknown;
  attachments: unknown;
  symbol: string | null;
  direction: string | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  timeframe: string | null;
  message_type: string;
  parsed_signal_json?: unknown;
  take_profits?: unknown;
  signal_hash?: string | null;
  auto_analysis_status?: string | null;
  auto_analysis_result_json?: unknown;
  auto_analysis_error?: string | null;
  auto_analysis_at?: Date | string | null;
  email_sent_at?: Date | string | null;
  email_status?: string | null;
  email_error?: string | null;
  telegram_date: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type StoredTelegramMessageInput = {
  telegramMessageId: string;
  chatId: string;
  chatTitle: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  rawText: string;
  replyInfo: TelegramReplyInfo | null;
  attachments: TelegramAttachmentMetadata[];
  telegramDate: string;
  parsed: ParsedTelegramSignal;
};

export type TelegramAutomationPatch = {
  autoAnalysisStatus?: string | null;
  autoAnalysisResult?: Record<string, unknown> | null;
  autoAnalysisError?: string | null;
  autoAnalysisAt?: string | null;
  emailSentAt?: string | null;
  emailStatus?: string | null;
  emailError?: string | null;
};

let tableReady = false;

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTelegramRow(row: TelegramRow): TelegramMessageRecord {
  const attachments = Array.isArray(row.attachments) ? row.attachments as TelegramAttachmentMetadata[] : [];
  const replyInfo = row.reply_info && typeof row.reply_info === 'object' ? row.reply_info as TelegramReplyInfo : null;
  const parsedSignal = row.parsed_signal_json && typeof row.parsed_signal_json === 'object'
    ? row.parsed_signal_json as Record<string, unknown>
    : null;
  const takeProfits = Array.isArray(row.take_profits)
    ? row.take_profits.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  return {
    id: row.id,
    telegramMessageId: row.telegram_message_id,
    chatId: row.chat_id,
    chatTitle: row.chat_title,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    rawText: row.raw_text,
    replyInfo,
    attachments,
    symbol: row.symbol,
    direction: (row.direction as TelegramMessageRecord['direction']) ?? null,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    takeProfits,
    timeframe: row.timeframe,
    messageType: row.message_type as TelegramMessageRecord['messageType'],
    telegramDate: toIsoString(row.telegram_date),
    parsedSignal,
    signalHash: row.signal_hash ?? null,
    autoAnalysisStatus: row.auto_analysis_status ?? null,
    autoAnalysisResult: row.auto_analysis_result_json && typeof row.auto_analysis_result_json === 'object'
      ? row.auto_analysis_result_json as Record<string, unknown>
      : null,
    autoAnalysisError: row.auto_analysis_error ?? null,
    autoAnalysisAt: row.auto_analysis_at ? toIsoString(row.auto_analysis_at) : null,
    emailSentAt: row.email_sent_at ? toIsoString(row.email_sent_at) : null,
    emailStatus: row.email_status ?? null,
    emailError: row.email_error ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function buildSignalHash(input: {
  chatId: string;
  telegramDate: string;
  rawText: string;
}) {
  return createHash('sha256')
    .update(`${input.chatId}|${input.telegramDate}|${input.rawText.trim()}`)
    .digest('hex');
}

async function ensureTelegramMessagesTable() {
  if (tableReady) return;
  if (!isDatabaseConfigured()) throw new Error('Database is not configured.');

  await execute(`
    CREATE TABLE IF NOT EXISTS "telegram_messages" (
      "id" UUID PRIMARY KEY,
      "telegram_message_id" TEXT NOT NULL,
      "chat_id" TEXT NOT NULL,
      "chat_title" TEXT,
      "sender_id" TEXT,
      "sender_name" TEXT,
      "text" TEXT NOT NULL,
      "raw_text" TEXT NOT NULL,
      "reply_info" JSONB,
      "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "symbol" TEXT,
      "direction" TEXT,
      "entry" DOUBLE PRECISION,
      "stop_loss" DOUBLE PRECISION,
      "take_profit" DOUBLE PRECISION,
      "parsed_signal_json" JSONB,
      "take_profits" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "signal_hash" TEXT,
      "auto_analysis_status" TEXT,
      "auto_analysis_result_json" JSONB,
      "auto_analysis_error" TEXT,
      "auto_analysis_at" TIMESTAMPTZ,
      "email_sent_at" TIMESTAMPTZ,
      "email_status" TEXT,
      "email_error" TEXT,
      "timeframe" TEXT,
      "message_type" TEXT NOT NULL,
      "telegram_date" TIMESTAMPTZ NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT telegram_messages_chat_message_unique UNIQUE ("chat_id", "telegram_message_id")
    );
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "reply_info" JSONB;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "parsed_signal_json" JSONB;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "take_profits" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "signal_hash" TEXT;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_status" TEXT;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_result_json" JSONB;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_error" TEXT;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_at" TIMESTAMPTZ;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMPTZ;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_status" TEXT;
  `);

  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_error" TEXT;
  `);

  await execute(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_telegram_date_idx"
    ON "telegram_messages" ("telegram_date" DESC);
  `);

  await execute(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_signal_hash_idx"
    ON "telegram_messages" ("signal_hash");
  `);

  tableReady = true;
}

export async function storeTelegramMessage(input: StoredTelegramMessageInput, strategy?: StorageStrategy) {
  const chosen = strategy ?? await resolveStorageStrategy();

  if (chosen === 'postgres_direct') {
    try {
      return await storeViaPostgres(input);
    } catch (error) {
      if (!isDatabaseConnectionError(error) || !isSupabaseConfigured()) throw error;
      console.warn('[Database] DATABASE_URL failed mid-save, falling back to Supabase client');
      setStrategy('supabase_client');
      return await storeViaSupabase(input);
    }
  }

  if (chosen === 'supabase_client') return await storeViaSupabase(input);

  throw new Error('Database is not configured.');
}

async function storeViaSupabase(input: StoredTelegramMessageInput) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client is not configured.');
  const signalHash = buildSignalHash(input);

  const { data, error } = await client
    .from(TABLE)
    .upsert(
      {
        id: randomUUID(),
        telegram_message_id: input.telegramMessageId,
        chat_id: input.chatId,
        chat_title: input.chatTitle,
        sender_id: input.senderId,
        sender_name: input.senderName,
        text: input.text,
        raw_text: input.rawText,
        reply_info: input.replyInfo,
        attachments: input.attachments ?? [],
        symbol: input.parsed.symbol,
        direction: input.parsed.direction,
        entry: input.parsed.entry,
        stop_loss: input.parsed.stopLoss,
        take_profit: input.parsed.takeProfit,
        parsed_signal_json: input.parsed,
        take_profits: input.parsed.takeProfits,
        signal_hash: signalHash,
        timeframe: input.parsed.timeframe,
        message_type: input.parsed.messageType,
        telegram_date: input.telegramDate,
      },
      { onConflict: 'chat_id,telegram_message_id', ignoreDuplicates: true },
    )
    .select();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  const inserted = Array.isArray(data) && data.length > 0;
  return { imported: inserted, record: inserted ? mapTelegramRow(data[0] as TelegramRow) : null };
}

async function listViaSupabase(filter: { limit?: number; symbol?: string; messageType?: string; direction?: string }) {
  const client = getSupabaseClient();
  if (!client) return [];
  const limitN = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  let q = client.from(TABLE).select('*').order('telegram_date', { ascending: false }).limit(limitN);
  if (filter.symbol) q = q.eq('symbol', filter.symbol.toUpperCase());
  if (filter.messageType && filter.messageType !== 'ALL') q = q.eq('message_type', filter.messageType.toUpperCase());
  if (filter.direction && filter.direction !== 'ALL') q = q.eq('direction', filter.direction.toUpperCase());
  const { data, error } = await q;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []).map((row) => mapTelegramRow(row as TelegramRow));
}

async function storeViaPostgres(input: StoredTelegramMessageInput) {
  await ensureTelegramMessagesTable();
  const signalHash = buildSignalHash(input);

  const result = await query<TelegramRow>(`
    INSERT INTO "telegram_messages" (
      "id",
      "telegram_message_id",
      "chat_id",
      "chat_title",
      "sender_id",
      "sender_name",
      "text",
      "raw_text",
      "reply_info",
      "attachments",
      "symbol",
      "direction",
      "entry",
      "stop_loss",
      "take_profit",
      "parsed_signal_json",
      "take_profits",
      "signal_hash",
      "timeframe",
      "message_type",
      "telegram_date"
    )
    VALUES (
      $1::uuid,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9::jsonb,
      $10::jsonb,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16::jsonb,
      $17::jsonb,
      $18,
      $19,
      $20,
      $21::timestamptz
    )
    ON CONFLICT ("chat_id", "telegram_message_id") DO NOTHING
    RETURNING *;
  `, [
    randomUUID(),
    input.telegramMessageId,
    input.chatId,
    input.chatTitle,
    input.senderId,
    input.senderName,
    input.text,
    input.rawText,
    input.replyInfo ? JSON.stringify(input.replyInfo) : null,
    JSON.stringify(input.attachments ?? []),
    input.parsed.symbol,
    input.parsed.direction,
    input.parsed.entry,
    input.parsed.stopLoss,
    input.parsed.takeProfit,
    JSON.stringify(input.parsed),
    JSON.stringify(input.parsed.takeProfits ?? []),
    signalHash,
    input.parsed.timeframe,
    input.parsed.messageType,
    input.telegramDate,
  ]);

  if (!result.rows.length) return { imported: false, record: null as TelegramMessageRecord | null };
  return { imported: true, record: mapTelegramRow(result.rows[0]) };
}

export async function listRecentTelegramMessages(filter: {
  limit?: number;
  symbol?: string;
  messageType?: string;
  direction?: string;
} = {}) {
  if (await resolveStorageStrategy() === 'supabase_client') {
    return listViaSupabase(filter);
  }

  await ensureTelegramMessagesTable();

  const values: unknown[] = [];
  const conditions: string[] = [];

  if (filter.symbol) {
    values.push(filter.symbol.toUpperCase());
    conditions.push(`"symbol" = $${values.length}`);
  }

  if (filter.messageType && filter.messageType !== 'ALL') {
    values.push(filter.messageType.toUpperCase());
    conditions.push(`"message_type" = $${values.length}`);
  }

  if (filter.direction && filter.direction !== 'ALL') {
    values.push(filter.direction.toUpperCase());
    conditions.push(`"direction" = $${values.length}`);
  }

  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  values.push(limit);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<TelegramRow>(`
    SELECT *
    FROM "telegram_messages"
    ${whereClause}
    ORDER BY "telegram_date" DESC
    LIMIT $${values.length};
  `, values);

  return rows.rows.map(mapTelegramRow);
}

export async function getTelegramMessageById(id: string) {
  if (await resolveStorageStrategy() === 'supabase_client') {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from(TABLE).select('*').eq('id', id).limit(1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0] as TelegramRow) : null;
  }

  await ensureTelegramMessagesTable();
  const rows = await query<TelegramRow>(`
    SELECT *
    FROM "telegram_messages"
    WHERE "id" = $1::uuid
    LIMIT 1;
  `, [id]);

  return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}

export async function getTelegramMessageCounts() {
  if (await resolveStorageStrategy() === 'supabase_client') {
    const client = getSupabaseClient();
    if (!client) return { total: 0, signals: 0, latestSync: null };
    const totalRes = await client.from(TABLE).select('*', { count: 'exact', head: true });
    const signalsRes = await client.from(TABLE).select('*', { count: 'exact', head: true }).eq('message_type', 'SIGNAL');
    const latestRes = await client.from(TABLE).select('updated_at').order('updated_at', { ascending: false }).limit(1);
    const latest = latestRes.data?.[0]?.updated_at as string | undefined;
    return {
      total: totalRes.count ?? 0,
      signals: signalsRes.count ?? 0,
      latestSync: latest ? toIsoString(latest) : null,
    };
  }

  await ensureTelegramMessagesTable();
  const rows = await query<{ total: string; signals: string; latest_sync: Date | string | null }>(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "message_type" = 'SIGNAL')::bigint AS signals,
      MAX("updated_at") AS latest_sync
    FROM "telegram_messages";
  `);

  const row = rows.rows[0];
  return {
    total: Number(row?.total ?? 0),
    signals: Number(row?.signals ?? 0),
    latestSync: row?.latest_sync ? toIsoString(row.latest_sync) : null,
  };
}

export async function getLatestTelegramMessageIdForChat(chatId: string) {
  // On the Supabase REST fallback we skip the cursor (PostgREST can't order by a
  // numeric cast); returning null just fetches recent history, which is safe.
  if (await resolveStorageStrategy() === 'supabase_client') return null;

  await ensureTelegramMessagesTable();
  const rows = await query<{ telegram_message_id: string | null }>(`
    SELECT "telegram_message_id"
    FROM "telegram_messages"
    WHERE "chat_id" = $1
    ORDER BY ("telegram_message_id")::bigint DESC
    LIMIT 1;
  `, [chatId]);

  return rows.rows[0]?.telegram_message_id ?? null;
}

export async function getTelegramMessageBySignalHash(signalHash: string) {
  if (!signalHash) return null;

  if (await resolveStorageStrategy() === 'supabase_client') {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from(TABLE).select('*').eq('signal_hash', signalHash).order('telegram_date', { ascending: false }).limit(1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0] as TelegramRow) : null;
  }

  await ensureTelegramMessagesTable();
  const rows = await query<TelegramRow>(`
    SELECT *
    FROM "telegram_messages"
    WHERE "signal_hash" = $1
    ORDER BY "telegram_date" DESC
    LIMIT 1;
  `, [signalHash]);

  return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}

export async function updateTelegramMessageAutomation(id: string, patch: TelegramAutomationPatch) {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ('autoAnalysisStatus' in patch) payload.auto_analysis_status = patch.autoAnalysisStatus ?? null;
  if ('autoAnalysisResult' in patch) payload.auto_analysis_result_json = patch.autoAnalysisResult ?? null;
  if ('autoAnalysisError' in patch) payload.auto_analysis_error = patch.autoAnalysisError ?? null;
  if ('autoAnalysisAt' in patch) payload.auto_analysis_at = patch.autoAnalysisAt ?? null;
  if ('emailSentAt' in patch) payload.email_sent_at = patch.emailSentAt ?? null;
  if ('emailStatus' in patch) payload.email_status = patch.emailStatus ?? null;
  if ('emailError' in patch) payload.email_error = patch.emailError ?? null;

  if (await resolveStorageStrategy() === 'supabase_client') {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client is not configured.');
    const { data, error } = await client.from(TABLE).update(payload).eq('id', id).select().limit(1);
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0] as TelegramRow) : null;
  }

  await ensureTelegramMessagesTable();
  const assignments: string[] = [];
  const values: unknown[] = [id];

  if ('auto_analysis_status' in payload) {
    values.push(payload.auto_analysis_status ?? null);
    assignments.push(`"auto_analysis_status" = $${values.length}`);
  }
  if ('auto_analysis_result_json' in payload) {
    values.push(JSON.stringify(payload.auto_analysis_result_json ?? null));
    assignments.push(`"auto_analysis_result_json" = $${values.length}::jsonb`);
  }
  if ('auto_analysis_error' in payload) {
    values.push(payload.auto_analysis_error ?? null);
    assignments.push(`"auto_analysis_error" = $${values.length}`);
  }
  if ('auto_analysis_at' in payload) {
    values.push(payload.auto_analysis_at ?? null);
    assignments.push(`"auto_analysis_at" = $${values.length}::timestamptz`);
  }
  if ('email_sent_at' in payload) {
    values.push(payload.email_sent_at ?? null);
    assignments.push(`"email_sent_at" = $${values.length}::timestamptz`);
  }
  if ('email_status' in payload) {
    values.push(payload.email_status ?? null);
    assignments.push(`"email_status" = $${values.length}`);
  }
  if ('email_error' in payload) {
    values.push(payload.email_error ?? null);
    assignments.push(`"email_error" = $${values.length}`);
  }
  values.push(payload.updated_at);
  assignments.push(`"updated_at" = $${values.length}::timestamptz`);

  const result = await query<TelegramRow>(`
    UPDATE "telegram_messages"
    SET
      ${assignments.join(',\n      ')}
    WHERE "id" = $1::uuid
    RETURNING *;
  `, values);

  return result.rows[0] ? mapTelegramRow(result.rows[0]) : null;
}

export function isTelegramStoreUnavailable(error: unknown) {
  return isDatabaseConnectionError(error);
}
