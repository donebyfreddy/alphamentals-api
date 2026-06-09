import {
  fetchTelegramHistory,
  getTelegramRuntimeState,
  TelegramBridgeError,
  testTelegramConnection,
  type TelegramBridgeMessagePayload,
} from './telegramBridge.service.js';
import { getTelegramEnvConfig } from '../config/telegram.js';
import {
  getTelegramMessageById,
  getTelegramMessageCounts,
  getLatestTelegramMessageIdForChat,
  isTelegramStoreUnavailable,
  listRecentTelegramMessages,
  resolveStorageStrategy,
  storeTelegramMessage,
  type StorageStrategy,
} from './telegramMessageStore.service.js';
import type {
  TelegramConnectionTestResult,
  TelegramMessageRecord,
  TelegramSignalAnalysis,
  TelegramStatus,
} from '../types/telegram.js';
import { isTelegramLimitOrderSignal, parseTelegramSignal } from '../../../src/utils/telegram/parseTelegramSignal.js';
import { analyzeTradingSignal } from './tradingviewBridge.service.js';
import { handleNewTelegramSignal } from './telegramAutoSignal.service.js';
import { validateTelegramTradeSignal } from './telegramSignalAnalyze.service.js';

type SyncState = {
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  isSyncing: boolean;
  lastCheckedChannels: number;
  lastNewMessages: number;
  lastNewSignals: number;
  lastEmailsSent: number;
};

type TelegramSignalSyncResult = {
  ok: boolean;
  checkedChannels: number;
  newMessages: number;
  newSignals: number;
  emailsSent: number;
  duplicatesSkipped: number;
  imported: number;
  skipped: number;
  errors: string[];
  messagesFetched: number;
  lastSyncAt: string;
  source: 'manual' | 'scheduled' | 'cron';
};

type TelegramSyncLogContext = {
  accountLabel?: string | null;
  checkedChannels?: number | null;
  targetChat?: string | null;
  resolvedChat?: string | null;
  resolvedChatType?: string | null;
  messagesRequested?: number | null;
  messagesFetched?: number | null;
  messagesSaved?: number | null;
  messagesSkipped?: number | null;
};

const syncState: SyncState = {
  lastSyncAt: null,
  nextSyncAt: null,
  lastError: null,
  isSyncing: false,
  lastCheckedChannels: 0,
  lastNewMessages: 0,
  lastNewSignals: 0,
  lastEmailsSent: 0,
};

// Prevents two overlapping sync jobs from running simultaneously.
let syncInFlight = false;

const SYNC_RATE_LIMIT_MS = 30_000;
let lastSyncRequestAt = 0;

/** Called by the background scheduler so the status endpoint can show the next run time. */
export function setSyncScheduleMetadata(nextSyncAt: Date): void {
  syncState.nextSyncAt = nextSyncAt.toISOString();
}

function buildFallbackAnalysis(message: TelegramMessageRecord): TelegramSignalAnalysis {
  const symbol = message.symbol ?? 'UNKNOWN';
  const hasSignal = message.messageType === 'SIGNAL' && message.symbol && message.direction;
  const tradeDirection = hasSignal && (message.direction === 'BUY' || message.direction === 'LONG')
    ? 'BUY'
    : hasSignal && (message.direction === 'SELL' || message.direction === 'SHORT')
      ? 'SELL'
      : 'NO_TRADE';
  const action = tradeDirection === 'NO_TRADE' ? 'NO_TRADE' : 'TRADE';
  const bias = tradeDirection === 'BUY' ? 'bullish' : tradeDirection === 'SELL' ? 'bearish' : 'mixed';
  const reason = hasSignal
    ? `Parsed ${symbol} signal from Telegram and prepared it for the Trading OS review flow.`
    : 'Message does not contain a complete structured trade signal, so the system stays on NO_TRADE.';

  return {
    status: 'processed',
    action,
    tradeDirection,
    bias,
    confidence: hasSignal ? 58 : 24,
    entry: message.entry,
    stopLoss: message.stopLoss,
    takeProfit: message.takeProfit,
    reason,
    riskNotes: hasSignal
      ? ['Telegram-originated idea. Validate with market structure, session timing, and macro context before execution.']
      : ['No complete trade signal was detected.'],
  };
}

function enforceSyncRateLimit() {
  const now = Date.now();
  if (now - lastSyncRequestAt < SYNC_RATE_LIMIT_MS) {
    const retrySeconds = Math.ceil((SYNC_RATE_LIMIT_MS - (now - lastSyncRequestAt)) / 1000);
    throw new Error(`Too many sync requests. Retry in ${retrySeconds} seconds.`);
  }
  lastSyncRequestAt = now;
}

function acquireSyncLock(): boolean {
  if (syncInFlight) return false;
  syncInFlight = true;
  syncState.isSyncing = true;
  return true;
}

function releaseSyncLock(error?: string | null) {
  syncInFlight = false;
  syncState.isSyncing = false;
  if (error !== undefined) syncState.lastError = error;
}

function updateSyncMetrics(result: TelegramSignalSyncResult) {
  syncState.lastSyncAt = result.lastSyncAt;
  syncState.lastError = result.errors[0] ?? null;
  syncState.lastCheckedChannels = result.checkedChannels;
  syncState.lastNewMessages = result.newMessages;
  syncState.lastNewSignals = result.newSignals;
  syncState.lastEmailsSent = result.emailsSent;
}

function logTelegramSyncStep(message: string, context: TelegramSyncLogContext = {}) {
  const payload = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null),
  );

  if (Object.keys(payload).length === 0) {
    console.log(`[Telegram] ${message}`);
    return;
  }

  console.log(`[Telegram] ${message}`, payload);
}

export async function ingestTelegramMessage(payload: TelegramBridgeMessagePayload, strategy?: StorageStrategy) {
  const parsed = parseTelegramSignal(payload.rawText);
  const stored = await storeTelegramMessage({
    telegramMessageId: payload.telegramMessageId,
    chatId: payload.chatId,
    chatTitle: payload.chatTitle,
    senderId: payload.senderId,
    senderName: payload.senderName,
    text: payload.text,
    rawText: payload.rawText,
    replyInfo: payload.replyInfo,
    attachments: payload.attachments ?? [],
    telegramDate: payload.telegramDate,
    parsed,
  }, strategy);

  return {
    ...stored,
    parsed,
  };
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const [counts, connection] = await Promise.all([
    getTelegramMessageCounts().catch(() => ({ total: 0, signals: 0, latestSync: null })),
    testTelegramConnection(),
  ]);
  const runtime = getTelegramRuntimeState();
  const targetChat = connection.targetChat?.id ?? runtime.targetChat;
  const configured = runtime.configured || Boolean(runtime.targetChat && runtime.enabled);
  const targetChatConfigured = Boolean(targetChat);
  const status: TelegramStatus['status'] = !configured
    ? 'not_configured'
    : connection.loggedIn && connection.targetChatResolved
      ? 'connected'
      : connection.loggedIn
        ? 'connected_target_chat_failed'
        : 'configured_login_failed';

  return {
    enabled: connection.enabled,
    configured,
    targetChatConfigured,
    connected: connection.connected,
    loggedIn: connection.loggedIn,
    targetChatAccessible: connection.targetChatAccessible,
    targetChat,
    targetChatTitle: connection.targetChat?.title ?? runtime.targetChatTitle,
    targetChatType: connection.targetChat?.type ?? runtime.targetChatType,
    targetChatResolved: connection.targetChatResolved,
    canReadMessages: connection.canReadMessages,
    messagesFetched: runtime.messagesFetched,
    currentPhase: connection.currentPhase ?? runtime.currentPhase,
    account: connection.account,
    lastMessageDate: connection.lastMessageDate,
    lastSyncAt: syncState.lastSyncAt ?? runtime.lastSyncAt ?? counts.latestSync,
    nextSyncAt: syncState.nextSyncAt,
    syncStatus: syncState.isSyncing ? 'syncing' : syncState.lastError ? 'error' : 'idle',
    lastCheckedChannels: syncState.lastCheckedChannels,
    lastNewMessages: syncState.lastNewMessages,
    lastNewSignals: syncState.lastNewSignals,
    lastEmailsSent: syncState.lastEmailsSent,
    error: connection.error ?? syncState.lastError ?? runtime.error,
    lastError: connection.error ?? syncState.lastError ?? runtime.error,
    errorCode: connection.code ?? runtime.code,
    errorPhase: connection.errorPhase ?? runtime.errorPhase,
    errorMessage: connection.errorMessage ?? connection.error ?? syncState.lastError ?? runtime.error,
    stack: connection.stack ?? runtime.stack,
    hints: connection.hints.length ? connection.hints : runtime.hints,
    status,
  };
}

export async function getTelegramConnectionTest(): Promise<TelegramConnectionTestResult> {
  return await testTelegramConnection();
}

async function runTelegramSync(limit: number, source: TelegramSignalSyncResult['source']): Promise<TelegramSignalSyncResult> {
  // Hard-cap at 10 messages per sync regardless of what the caller requests.
  const clampedLimit = Math.min(Math.max(limit, 1), 10);
  const runtime = getTelegramRuntimeState();
  const config = getTelegramEnvConfig();

  logTelegramSyncStep('Sync started', { messagesRequested: clampedLimit });

  // Use cached runtime state for labels — avoids a redundant testTelegramConnection()
  // subprocess call (which would add up to 30s before the real fetch even starts,
  // causing Render's 30s request timeout to fire and return a 502).
  const targetChat = runtime.targetChat ?? config.targetChat;
  const accountLabel = runtime.accountUsername ? `@${runtime.accountUsername}` : null;
  const resolvedChat = runtime.targetChatTitle ?? targetChat;
  const resolvedChatType = runtime.targetChatType ?? null;
  const checkedChannels = targetChat ? 1 : 0;

  logTelegramSyncStep('Sync using cached session state', { accountLabel, targetChat, resolvedChat, resolvedChatType });

  // cursor: numeric chat_id stored by previous syncs; may be null if the monitor
  // hasn't resolved the chat yet — in that case we fall back to the latest N messages
  // and rely on duplicate detection at insert time.
  const latestMessageId = targetChat ? await getLatestTelegramMessageIdForChat(targetChat).catch(() => null) : null;
  if (latestMessageId) {
    logTelegramSyncStep(`Stored last processed message ID for channel: ${latestMessageId}`, { targetChat, resolvedChat });
  } else {
    logTelegramSyncStep('No stored message cursor found for channel. Fetching recent history.', { targetChat, resolvedChat });
  }

  const result = await fetchTelegramHistory(clampedLimit, latestMessageId);
  const messages = result.messages ?? [];
  const fetchedCount = result.messages_fetched ?? messages.length;
  const effectiveResolvedChat = result.chat?.title ?? resolvedChat;

  logTelegramSyncStep('Channels checked', { checkedChannels, accountLabel, targetChat, resolvedChat: effectiveResolvedChat });
  logTelegramSyncStep('Messages fetched', {
    accountLabel,
    targetChat,
    resolvedChat: effectiveResolvedChat,
    messagesFetched: fetchedCount,
  });

  if (messages.length === 0) {
    const emptyResult: TelegramSignalSyncResult = {
      ok: true,
      checkedChannels,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      duplicatesSkipped: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      messagesFetched: 0,
      lastSyncAt: new Date().toISOString(),
      source,
    };
    updateSyncMetrics(emptyResult);
    return emptyResult;
  }

  const storageStrategy = await resolveStorageStrategy(true);
  if (storageStrategy === 'unavailable') {
    throw new TelegramBridgeError(
      'TELEGRAM_UNAVAILABLE',
      'Telegram messages were fetched but could not be saved to the database.',
      'Database unreachable: configure DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
      {
        phase: 'database_save',
        operation: 'syncTelegramSignals',
        targetChat,
        loginOk: true,
        targetChatResolved: true,
        canReadMessages: true,
        account: runtime.account ?? null,
        targetChatInfo: null,
        hints: [
          'Provide a reachable DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL.',
          'Then retry the Telegram sync.',
        ],
      },
    );
  }

  let imported = 0;
  let skipped = 0;
  let duplicatesSkipped = 0;
  let newSignals = 0;
  let emailsSent = 0;
  const errors: string[] = [];

  for (const [index, payload] of messages.entries()) {
    logTelegramSyncStep(`Processing message ${index + 1}/${messages.length}`, {
      targetChat,
      resolvedChat: effectiveResolvedChat,
      messagesFetched: fetchedCount,
      messagesSaved: imported,
      messagesSkipped: skipped,
    });
    try {
      const stored = await ingestTelegramMessage(payload, storageStrategy);
      const isValidSignal = stored.parsed.messageType === 'SIGNAL' && isTelegramLimitOrderSignal(payload.rawText, stored.parsed);

      if (stored.imported) {
        imported += 1;
        if (isValidSignal) {
          newSignals += 1;
          if (stored.record) {
            // Fire-and-forget: do NOT await — AI analysis + email run in background.
            // Sync completes immediately after storing the signal.
            const signalRecord = stored.record;
            void handleNewTelegramSignal(signalRecord).then((automation) => {
              if (!automation.skipped && 'sent' in automation && automation.sent) {
                console.log('[Telegram] Background signal email sent', { messageId: signalRecord.id, symbol: signalRecord.symbol });
              }
            }).catch((err: unknown) => {
              console.error('[Telegram] Background signal processing failed', {
                messageId: signalRecord.id,
                symbol: signalRecord.symbol,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
        console.log('[Telegram] Message saved', {
          telegramMessageId: payload.telegramMessageId,
          messageType: stored.parsed.messageType,
          isValidSignal,
          targetChat,
          resolvedChat: effectiveResolvedChat,
        });
      } else {
        skipped += 1;
        duplicatesSkipped += 1;
        console.log('[Telegram] Duplicate skipped', {
          telegramMessageId: payload.telegramMessageId,
          targetChat,
          resolvedChat: effectiveResolvedChat,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Telegram message processing error';
      errors.push(errorMessage);
      console.error('[Telegram] Message processing failed', {
        phase: 'database_save',
        operation: 'syncTelegramSignals',
        telegramMessageId: payload.telegramMessageId,
        targetChat,
        resolvedChat: effectiveResolvedChat,
        error: errorMessage,
      });
    }
  }

  const syncResult: TelegramSignalSyncResult = {
    ok: true,
    checkedChannels,
    newMessages: imported,
    newSignals,
    emailsSent,
    duplicatesSkipped,
    imported,
    skipped,
    errors,
    messagesFetched: fetchedCount,
    lastSyncAt: new Date().toISOString(),
    source,
  };

  updateSyncMetrics(syncResult);
  logTelegramSyncStep('Sync finished', {
    accountLabel,
    targetChat,
    resolvedChat: effectiveResolvedChat,
    messagesFetched: fetchedCount,
    messagesSaved: imported,
    messagesSkipped: skipped,
  });
  logTelegramSyncStep('Valid signals parsed', { targetChat, resolvedChat: effectiveResolvedChat, messagesSaved: newSignals });
  logTelegramSyncStep('Emails sent', { targetChat, resolvedChat: effectiveResolvedChat, messagesSaved: emailsSent });
  return syncResult;
}

export async function syncTelegramSignals(limit = 10, options: { source?: TelegramSignalSyncResult['source']; enforceRateLimit?: boolean } = {}) {
  const source = options.source ?? 'manual';
  if (options.enforceRateLimit ?? source === 'manual') {
    enforceSyncRateLimit();
  }
  if (!acquireSyncLock()) {
    throw new Error('Sync already in progress. Please wait for the current sync to complete.');
  }

  try {
    const result = await runTelegramSync(limit, source);
    releaseSyncLock(result.errors[0] ?? null);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown Telegram sync error';
    releaseSyncLock(msg);
    throw error;
  }
}

export async function syncTelegramMessages(limit = 10) {
  const result = await syncTelegramSignals(limit, { source: 'manual', enforceRateLimit: true });
  return {
    success: result.ok,
    imported: result.imported,
    skipped: result.skipped,
    errors: result.errors,
    messagesFetched: result.messagesFetched,
    checkedChannels: result.checkedChannels,
    newMessages: result.newMessages,
    newSignals: result.newSignals,
    emailsSent: result.emailsSent,
  };
}

export async function syncTelegramMessagesScheduled(limit = 10) {
  try {
    return await syncTelegramSignals(limit, { source: 'scheduled', enforceRateLimit: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Scheduled sync failed';
    console.error('[Telegram] Scheduled sync failed:', msg);
    return null;
  }
}

export async function getRecentTelegramMessages(filter: {
  limit?: number;
  symbol?: string;
  messageType?: string;
  direction?: string;
}) {
  console.log('[Telegram] UI message query started', {
    phase: 'frontend_response',
    operation: 'listRecentTelegramMessages',
    filters: filter,
  });
  const messages = await listRecentTelegramMessages(filter);
  const limitMessages = messages.filter((message) => isTelegramLimitOrderSignal(message.rawText, {
    messageType: message.messageType,
    direction: message.direction,
  }));
  console.log('[Telegram] UI message query result', {
    phase: 'frontend_response',
    operation: 'listRecentTelegramMessages',
    returned: limitMessages.length,
    fetchedBeforeFilter: messages.length,
    filters: filter,
  });
  if (messages.length > 0 && limitMessages.length === 0) {
    console.warn('[Telegram] Messages fetched but filtered out because they are not BUY LIMIT / SELL LIMIT signals.', {
      phase: 'frontend_response',
      operation: 'listRecentTelegramMessages',
      fetchedBeforeFilter: messages.length,
      returned: 0,
      hint: 'Only pending limit order signals are shown in the dashboard.',
    });
  }
  if (limitMessages.length === 0) {
    console.warn('[Telegram] UI query returned 0 saved messages.', {
      phase: 'frontend_response',
      operation: 'listRecentTelegramMessages',
      filters: filter,
      hint: 'Messages may have been filtered out because they are not BUY LIMIT / SELL LIMIT signals, skipped as duplicates, not saved, or frontend filters removed them.',
    });
  }
  return limitMessages;
}

export async function analyzeTelegramMessage(messageId: string) {
  const message = await getTelegramMessageById(messageId);
  if (!message) throw new Error('Telegram message not found.');

  if (!message.symbol || !message.direction || message.messageType !== 'SIGNAL') {
    return buildFallbackAnalysis(message);
  }

  const parsedOverride = {
    symbol: message.symbol ?? undefined,
    direction: message.direction ?? undefined,
    orderType: (message.parsedSignal?.orderType as 'MARKET' | 'LIMIT' | 'STOP' | null | undefined) ?? undefined,
    entry: message.entry ?? undefined,
    stopLoss: message.stopLoss ?? undefined,
    takeProfits: Array.isArray(message.takeProfits) ? message.takeProfits : undefined,
    timeframe: message.timeframe ?? undefined,
    messageType: message.messageType,
  };

  const validated = await validateTelegramTradeSignal(message.rawText, parsedOverride, {
    signalTime: message.telegramDate,
    sourceMessage: message.rawText,
  });
  if (validated.ok) {
    const tradeDirection = validated.parsedSignal.direction === 'BUY'
      ? 'BUY'
      : validated.parsedSignal.direction === 'SELL'
        ? 'SELL'
        : 'NO_TRADE';

    return {
      status: 'processed',
      action: validated.finalAction === 'avoid' ? 'NO_TRADE' : 'TRADE',
      tradeDirection,
      bias: validated.fundamentalAlignment === 'aligned'
        ? tradeDirection === 'BUY'
          ? 'bullish'
          : tradeDirection === 'SELL'
            ? 'bearish'
            : 'mixed'
        : 'mixed',
      confidence: validated.confidence,
      entry: validated.parsedSignal.entry,
      stopLoss: validated.parsedSignal.sl,
      takeProfit: validated.parsedSignal.tps[0] ?? null,
      takeProfitSecondary: validated.parsedSignal.tps[1] ?? null,
      reason: validated.summary,
      riskNotes: validated.keyRisks,
      analysis: validated as unknown as Record<string, unknown>,
      context: {
        technicalContext: validated.technicalContext,
        macroBias: validated.macroBias,
        calendarRisk: validated.calendarRisk,
        usedAnalysisGeneratedAt: validated.usedAnalysisGeneratedAt,
      },
    } satisfies TelegramSignalAnalysis;
  }

  try {
    const response = await analyzeTradingSignal({
      symbol: message.symbol,
      timeframe: message.timeframe ?? '15m',
      signal: message.direction === 'LONG' ? 'BUY' : message.direction === 'SHORT' ? 'SELL' : message.direction,
      price: message.entry ?? message.takeProfit ?? message.stopLoss ?? 0,
      strategy: 'Telegram imported signal',
      message: message.text,
      signal_type: 'setup_detected',
      direction_hint: message.direction === 'BUY' || message.direction === 'LONG' ? 'buy' : 'sell',
      support: message.stopLoss ?? undefined,
      resistance: message.takeProfit ?? undefined,
    });

    return {
      status: 'processed',
      action: response.analysis.decision === 'BUY' || response.analysis.decision === 'SELL' ? 'TRADE' : 'NO_TRADE',
      tradeDirection: response.analysis.decision,
      bias: response.analysis.bias === 'neutral' ? 'mixed' : response.analysis.bias ?? 'mixed',
      confidence: response.analysis.confidence,
      entry: response.analysis.entry_zone.low && response.analysis.entry_zone.high
        ? Number(((response.analysis.entry_zone.low + response.analysis.entry_zone.high) / 2).toFixed(message.symbol === 'XAUUSD' ? 2 : 5))
        : null,
      stopLoss: response.analysis.stop_loss || null,
      takeProfit: response.analysis.take_profit_1 || null,
      takeProfitSecondary: response.analysis.take_profit_2 || null,
      reason: response.analysis.reasoning.join(' '),
      riskNotes: [...response.analysis.warnings, ...response.analysis.invalid_if],
      analysis: response.analysis as unknown as Record<string, unknown>,
      context: response.context as unknown as Record<string, unknown>,
    } satisfies TelegramSignalAnalysis;
  } catch {
    return buildFallbackAnalysis(message);
  }
}

/** Map the failing phase + progress flags to a precise, human-readable reason. */
function derivePhaseMessage(args: {
  phase: string | null;
  loginOk: boolean;
  targetChatResolved: boolean;
  canReadMessages: boolean;
  fallback: string;
}): string {
  const { phase, loginOk, targetChatResolved, fallback } = args;
  const p = (phase ?? '').toLowerCase();

  if (p.includes('target_chat') || p.includes('resolve')) return 'Target chat could not be resolved';
  if (p.includes('save') || p.includes('database') || p.includes('store')) return 'Messages fetched but failed to save to database';
  if (p.includes('fetch') || p.includes('message') || p.includes('read')) {
    return loginOk
      ? 'Telegram login succeeded but message fetching failed'
      : fallback;
  }
  if (p.includes('login') || p.includes('auth') || p.includes('connect')) {
    return targetChatResolved ? fallback : 'Telegram login failed';
  }
  return fallback;
}

export function normalizeTelegramRouteError(error: unknown) {
  if (error instanceof TelegramBridgeError) {
    return {
      status: error.status,
      message: derivePhaseMessage({
        phase: error.phase,
        loginOk: error.loginOk,
        targetChatResolved: error.targetChatResolved,
        canReadMessages: error.canReadMessages,
        fallback: error.message,
      }),
      rawMessage: error.message,
      code: error.code,
      phase: error.phase,
      operation: error.operation,
      stack: error.stackDetails,
      hints: error.hints,
      account: error.account,
      targetChat: error.targetChat,
      targetChatInfo: error.targetChatInfo,
      loginOk: error.loginOk,
      targetChatResolved: error.targetChatResolved,
      canReadMessages: error.canReadMessages,
      telegramError: error.errorName ?? error.errorCode ?? null,
      details: error.details,
    };
  }
  if (isTelegramStoreUnavailable(error)) {
    return {
      status: 503,
      message: 'Messages fetched but failed to save to database',
      rawMessage: 'Telegram storage is unavailable because the database is not reachable.',
      code: 'DATABASE_UNAVAILABLE',
      phase: 'database_save',
      hints: ['Confirm the database is running and DATABASE_URL is reachable.'],
    };
  }
  if (error instanceof Error) return { status: 500, message: error.message, rawMessage: error.message, code: 'INTERNAL_ERROR', stack: error.stack, hints: [] };
  return { status: 500, message: 'Unknown Telegram error', rawMessage: 'Unknown Telegram error', code: 'UNKNOWN_ERROR', stack: null, hints: [] };
}
