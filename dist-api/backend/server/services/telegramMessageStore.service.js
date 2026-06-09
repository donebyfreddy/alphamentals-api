"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logDatabaseDiagnostics = logDatabaseDiagnostics;
exports.resolveStorageStrategy = resolveStorageStrategy;
exports.storeTelegramMessage = storeTelegramMessage;
exports.listRecentTelegramMessages = listRecentTelegramMessages;
exports.getTelegramMessageById = getTelegramMessageById;
exports.getTelegramMessageCounts = getTelegramMessageCounts;
exports.getLatestTelegramMessageIdForChat = getLatestTelegramMessageIdForChat;
exports.getTelegramMessageBySignalHash = getTelegramMessageBySignalHash;
exports.updateTelegramMessageAutomation = updateTelegramMessageAutomation;
exports.isTelegramStoreUnavailable = isTelegramStoreUnavailable;
const node_crypto_1 = require("node:crypto");
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
const wsTransport = ws_1.default;
const db_js_1 = require("../lib/db.js");
const TABLE = 'telegram_messages';
// ── Supabase REST fallback ───────────────────────────────────────────────────
// The direct Postgres host can be unreachable while the Supabase REST endpoint
// still works. We never reconstruct or hardcode a DB hostname — we use whichever
// credential set the environment already provides (DATABASE_URL, else Supabase).
let supabaseClient;
function getSupabaseClient() {
    if (supabaseClient !== undefined)
        return supabaseClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
        supabaseClient = null;
        return null;
    }
    supabaseClient = (0, supabase_js_1.createClient)(url, key, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: wsTransport } });
    return supabaseClient;
}
function isSupabaseConfigured() {
    return Boolean(getSupabaseClient());
}
let cachedStrategy = null;
const STRATEGY_TTL_MS = 30_000;
function logDatabaseDiagnostics() {
    const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
    const publishable = Boolean(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    console.info(`[Database] DATABASE_URL configured: ${(0, db_js_1.isDatabaseConfigured)() ? 'yes' : 'no'}`);
    console.info(`[Database] SUPABASE_SERVICE_ROLE_KEY configured: ${serviceRole ? 'yes' : 'no'}`);
    console.info(`[Database] SUPABASE_PUBLISHABLE_KEY configured: ${publishable ? 'yes' : 'no'}`);
}
/** Decide once (cached) how to talk to the database: direct Postgres, Supabase REST, or neither. */
async function resolveStorageStrategy(force = false) {
    if (!force && cachedStrategy && Date.now() - cachedStrategy.at < STRATEGY_TTL_MS)
        return cachedStrategy.value;
    logDatabaseDiagnostics();
    let value = 'unavailable';
    if ((0, db_js_1.isDatabaseConfigured)()) {
        const health = await (0, db_js_1.checkDatabaseConnection)();
        if (health.ok) {
            console.info('[Database] Using DATABASE_URL');
            value = 'postgres_direct';
        }
        else if (isSupabaseConfigured()) {
            console.warn('[Database] DATABASE_URL failed');
            console.warn('[Database] Falling back to Supabase service role client');
            value = 'supabase_client';
        }
    }
    else if (isSupabaseConfigured()) {
        value = 'supabase_client';
    }
    console.info(`[Database] Using database strategy: ${value}`);
    cachedStrategy = { value, at: Date.now() };
    return value;
}
function setStrategy(value) {
    cachedStrategy = { value, at: Date.now() };
}
let tableReady = false;
function toIsoString(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function mapTelegramRow(row) {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    const replyInfo = row.reply_info && typeof row.reply_info === 'object' ? row.reply_info : null;
    const parsedSignal = row.parsed_signal_json && typeof row.parsed_signal_json === 'object'
        ? row.parsed_signal_json
        : null;
    const takeProfits = Array.isArray(row.take_profits)
        ? row.take_profits.filter((value) => typeof value === 'number' && Number.isFinite(value))
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
        direction: row.direction ?? null,
        entry: row.entry,
        stopLoss: row.stop_loss,
        takeProfit: row.take_profit,
        takeProfits,
        timeframe: row.timeframe,
        messageType: row.message_type,
        telegramDate: toIsoString(row.telegram_date),
        parsedSignal,
        signalHash: row.signal_hash ?? null,
        autoAnalysisStatus: row.auto_analysis_status ?? null,
        autoAnalysisResult: row.auto_analysis_result_json && typeof row.auto_analysis_result_json === 'object'
            ? row.auto_analysis_result_json
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
function buildSignalHash(input) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(`${input.chatId}|${input.telegramDate}|${input.rawText.trim()}`)
        .digest('hex');
}
async function ensureTelegramMessagesTable() {
    if (tableReady)
        return;
    if (!(0, db_js_1.isDatabaseConfigured)())
        throw new Error('Database is not configured.');
    await (0, db_js_1.execute)(`
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
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "reply_info" JSONB;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "parsed_signal_json" JSONB;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "take_profits" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "signal_hash" TEXT;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_status" TEXT;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_result_json" JSONB;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_error" TEXT;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_at" TIMESTAMPTZ;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMPTZ;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_status" TEXT;
  `);
    await (0, db_js_1.execute)(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_error" TEXT;
  `);
    await (0, db_js_1.execute)(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_telegram_date_idx"
    ON "telegram_messages" ("telegram_date" DESC);
  `);
    await (0, db_js_1.execute)(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_signal_hash_idx"
    ON "telegram_messages" ("signal_hash");
  `);
    tableReady = true;
}
async function storeTelegramMessage(input, strategy) {
    const chosen = strategy ?? await resolveStorageStrategy();
    if (chosen === 'postgres_direct') {
        try {
            return await storeViaPostgres(input);
        }
        catch (error) {
            if (!(0, db_js_1.isDatabaseConnectionError)(error) || !isSupabaseConfigured())
                throw error;
            console.warn('[Database] DATABASE_URL failed mid-save, falling back to Supabase client');
            setStrategy('supabase_client');
            return await storeViaSupabase(input);
        }
    }
    if (chosen === 'supabase_client')
        return await storeViaSupabase(input);
    throw new Error('Database is not configured.');
}
async function storeViaSupabase(input) {
    const client = getSupabaseClient();
    if (!client)
        throw new Error('Supabase client is not configured.');
    const signalHash = buildSignalHash(input);
    const { data, error } = await client
        .from(TABLE)
        .upsert({
        id: (0, node_crypto_1.randomUUID)(),
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
    }, { onConflict: 'chat_id,telegram_message_id', ignoreDuplicates: true })
        .select();
    if (error)
        throw new Error(`Supabase insert failed: ${error.message}`);
    const inserted = Array.isArray(data) && data.length > 0;
    return { imported: inserted, record: inserted ? mapTelegramRow(data[0]) : null };
}
async function listViaSupabase(filter) {
    const client = getSupabaseClient();
    if (!client)
        return [];
    const limitN = Math.min(Math.max(filter.limit ?? 30, 1), 100);
    let q = client.from(TABLE).select('*').order('telegram_date', { ascending: false }).limit(limitN);
    if (filter.symbol)
        q = q.eq('symbol', filter.symbol.toUpperCase());
    if (filter.messageType && filter.messageType !== 'ALL')
        q = q.eq('message_type', filter.messageType.toUpperCase());
    if (filter.direction && filter.direction !== 'ALL')
        q = q.eq('direction', filter.direction.toUpperCase());
    const { data, error } = await q;
    if (error)
        throw new Error(`Supabase query failed: ${error.message}`);
    return (data ?? []).map((row) => mapTelegramRow(row));
}
async function storeViaPostgres(input) {
    await ensureTelegramMessagesTable();
    const signalHash = buildSignalHash(input);
    const result = await (0, db_js_1.query)(`
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
        (0, node_crypto_1.randomUUID)(),
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
    if (!result.rows.length)
        return { imported: false, record: null };
    return { imported: true, record: mapTelegramRow(result.rows[0]) };
}
async function listRecentTelegramMessages(filter = {}) {
    if (await resolveStorageStrategy() === 'supabase_client') {
        return listViaSupabase(filter);
    }
    await ensureTelegramMessagesTable();
    const values = [];
    const conditions = [];
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
    const rows = await (0, db_js_1.query)(`
    SELECT *
    FROM "telegram_messages"
    ${whereClause}
    ORDER BY "telegram_date" DESC
    LIMIT $${values.length};
  `, values);
    return rows.rows.map(mapTelegramRow);
}
async function getTelegramMessageById(id) {
    if (await resolveStorageStrategy() === 'supabase_client') {
        const client = getSupabaseClient();
        if (!client)
            return null;
        const { data, error } = await client.from(TABLE).select('*').eq('id', id).limit(1);
        if (error)
            throw new Error(`Supabase query failed: ${error.message}`);
        return data?.[0] ? mapTelegramRow(data[0]) : null;
    }
    await ensureTelegramMessagesTable();
    const rows = await (0, db_js_1.query)(`
    SELECT *
    FROM "telegram_messages"
    WHERE "id" = $1::uuid
    LIMIT 1;
  `, [id]);
    return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}
async function getTelegramMessageCounts() {
    if (await resolveStorageStrategy() === 'supabase_client') {
        const client = getSupabaseClient();
        if (!client)
            return { total: 0, signals: 0, latestSync: null };
        const totalRes = await client.from(TABLE).select('*', { count: 'exact', head: true });
        const signalsRes = await client.from(TABLE).select('*', { count: 'exact', head: true }).eq('message_type', 'SIGNAL');
        const latestRes = await client.from(TABLE).select('updated_at').order('updated_at', { ascending: false }).limit(1);
        const latest = latestRes.data?.[0]?.updated_at;
        return {
            total: totalRes.count ?? 0,
            signals: signalsRes.count ?? 0,
            latestSync: latest ? toIsoString(latest) : null,
        };
    }
    await ensureTelegramMessagesTable();
    const rows = await (0, db_js_1.query)(`
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
async function getLatestTelegramMessageIdForChat(chatId) {
    // On the Supabase REST fallback we skip the cursor (PostgREST can't order by a
    // numeric cast); returning null just fetches recent history, which is safe.
    if (await resolveStorageStrategy() === 'supabase_client')
        return null;
    await ensureTelegramMessagesTable();
    const rows = await (0, db_js_1.query)(`
    SELECT "telegram_message_id"
    FROM "telegram_messages"
    WHERE "chat_id" = $1
    ORDER BY ("telegram_message_id")::bigint DESC
    LIMIT 1;
  `, [chatId]);
    return rows.rows[0]?.telegram_message_id ?? null;
}
async function getTelegramMessageBySignalHash(signalHash) {
    if (!signalHash)
        return null;
    if (await resolveStorageStrategy() === 'supabase_client') {
        const client = getSupabaseClient();
        if (!client)
            return null;
        const { data, error } = await client.from(TABLE).select('*').eq('signal_hash', signalHash).order('telegram_date', { ascending: false }).limit(1);
        if (error)
            throw new Error(`Supabase query failed: ${error.message}`);
        return data?.[0] ? mapTelegramRow(data[0]) : null;
    }
    await ensureTelegramMessagesTable();
    const rows = await (0, db_js_1.query)(`
    SELECT *
    FROM "telegram_messages"
    WHERE "signal_hash" = $1
    ORDER BY "telegram_date" DESC
    LIMIT 1;
  `, [signalHash]);
    return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}
async function updateTelegramMessageAutomation(id, patch) {
    const payload = {
        updated_at: new Date().toISOString(),
    };
    if ('autoAnalysisStatus' in patch)
        payload.auto_analysis_status = patch.autoAnalysisStatus ?? null;
    if ('autoAnalysisResult' in patch)
        payload.auto_analysis_result_json = patch.autoAnalysisResult ?? null;
    if ('autoAnalysisError' in patch)
        payload.auto_analysis_error = patch.autoAnalysisError ?? null;
    if ('autoAnalysisAt' in patch)
        payload.auto_analysis_at = patch.autoAnalysisAt ?? null;
    if ('emailSentAt' in patch)
        payload.email_sent_at = patch.emailSentAt ?? null;
    if ('emailStatus' in patch)
        payload.email_status = patch.emailStatus ?? null;
    if ('emailError' in patch)
        payload.email_error = patch.emailError ?? null;
    if (await resolveStorageStrategy() === 'supabase_client') {
        const client = getSupabaseClient();
        if (!client)
            throw new Error('Supabase client is not configured.');
        const { data, error } = await client.from(TABLE).update(payload).eq('id', id).select().limit(1);
        if (error)
            throw new Error(`Supabase update failed: ${error.message}`);
        return data?.[0] ? mapTelegramRow(data[0]) : null;
    }
    await ensureTelegramMessagesTable();
    const assignments = [];
    const values = [id];
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
    const result = await (0, db_js_1.query)(`
    UPDATE "telegram_messages"
    SET
      ${assignments.join(',\n      ')}
    WHERE "id" = $1::uuid
    RETURNING *;
  `, values);
    return result.rows[0] ? mapTelegramRow(result.rows[0]) : null;
}
function isTelegramStoreUnavailable(error) {
    return (0, db_js_1.isDatabaseConnectionError)(error);
}
