export type TelegramMessageType = 'SIGNAL' | 'UPDATE' | 'CLOSE' | 'INFO' | 'UNKNOWN' | 'signal' | 'update' | 'close' | 'info' | 'unknown';
export type TelegramSignalDirection = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'UNKNOWN';

export interface ParsedTelegramSignal {
  messageType: TelegramMessageType;
  type: TelegramMessageType;
  direction: TelegramSignalDirection;
  symbol: string | null;
  entry: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfits: number[];
  orderType: string | null;
  timeframe: string | null;
  rawText: string;
  confidence: number;
  isLimitOrder: boolean;
}

export function parseTelegramSignal(text: string, _context?: unknown): ParsedTelegramSignal {
  return {
    messageType: 'UNKNOWN',
    type: 'unknown',
    direction: 'UNKNOWN',
    symbol: null,
    entry: null,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    takeProfits: [],
    orderType: null,
    timeframe: null,
    rawText: text,
    confidence: 0,
    isLimitOrder: false,
  };
}

export function isTelegramLimitOrderSignal(_textOrSignal: unknown, _signal?: Pick<ParsedTelegramSignal, 'messageType' | 'direction'>): boolean {
  return false;
}
