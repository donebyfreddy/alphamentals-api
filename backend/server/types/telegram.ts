import type { TelegramMessageType, TelegramSignalDirection } from '../../../src/utils/telegram/parseTelegramSignal.js';

export type TelegramStatus = {
  enabled: boolean;
  configured: boolean;
  targetChatConfigured: boolean;
  connected: boolean;
  loggedIn: boolean;
  targetChatAccessible: boolean;
  targetChat: string | null;
  targetChatTitle?: string | null;
  targetChatType?: string | null;
  targetChatResolved: boolean;
  canReadMessages: boolean;
  messagesFetched: number;
  currentPhase: string | null;
  account: {
    id: string | null;
    username: string | null;
    displayName: string | null;
  } | null;
  lastMessageDate: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastCheckedChannels: number;
  lastNewMessages: number;
  lastNewSignals: number;
  lastEmailsSent: number;
  error: string | null;
  lastError: string | null;
  errorCode: string | null;
  errorPhase: string | null;
  errorMessage: string | null;
  stack: string | null;
  hints: string[];
  status: 'not_configured' | 'configured_login_failed' | 'connected_target_chat_failed' | 'connected';
};

export type TelegramAttachmentMetadata = {
  type: string;
  id?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  [key: string]: unknown;
};

export type TelegramReplyInfo = {
  replyToMessageId: string | null;
  repliedToSenderId: string | null;
  repliedToSenderName: string | null;
  repliedToText: string | null;
};

export type TelegramSignalAnalysis = {
  status: 'processed';
  action: 'TRADE' | 'NO_TRADE';
  tradeDirection: 'BUY' | 'SELL' | 'NO_TRADE';
  bias: 'bullish' | 'bearish' | 'mixed';
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfitSecondary?: number | null;
  reason: string;
  riskNotes: string[];
  analysis?: Record<string, unknown>;
  context?: Record<string, unknown> | null;
};

export type TelegramMessageRecord = {
  id: string;
  telegramMessageId: string;
  chatId: string;
  chatTitle: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  rawText: string;
  replyInfo: TelegramReplyInfo | null;
  attachments: TelegramAttachmentMetadata[];
  symbol: string | null;
  direction: TelegramSignalDirection;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  timeframe: string | null;
  messageType: TelegramMessageType;
  telegramDate: string;
  takeProfits?: number[];
  parsedSignal?: Record<string, unknown> | null;
  signalHash?: string | null;
  autoAnalysisStatus?: string | null;
  autoAnalysisResult?: Record<string, unknown> | null;
  autoAnalysisError?: string | null;
  autoAnalysisAt?: string | null;
  emailSentAt?: string | null;
  emailStatus?: string | null;
  emailError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TelegramConnectionTestResult = {
  enabled: boolean;
  connected: boolean;
  loggedIn: boolean;
  targetChatAccessible: boolean;
  targetChatResolved: boolean;
  canReadMessages: boolean;
  messagesFetched: number;
  currentPhase: string | null;
  lastMessageDate: string | null;
  account: {
    id: string | null;
    username: string | null;
    displayName: string | null;
  } | null;
  targetChat: {
    id: string | null;
    title: string | null;
    type: string | null;
    username?: string | null;
    normalized?: string | null;
  } | null;
  error: string | null;
  code: string | null;
  errorPhase: string | null;
  errorMessage?: string | null;
  stack?: string | null;
  hints: string[];
};
