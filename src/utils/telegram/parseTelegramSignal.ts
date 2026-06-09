export type TelegramMessageType = 'signal' | 'update' | 'close' | 'info' | 'unknown';
export type TelegramSignalDirection = 'BUY' | 'SELL' | 'UNKNOWN';

export interface ParsedTelegramSignal {
  type: TelegramMessageType;
  direction: TelegramSignalDirection;
  symbol: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  rawText: string;
  confidence: number;
  isLimitOrder: boolean;
}

export function parseTelegramSignal(text: string): ParsedTelegramSignal {
  return {
    type: 'unknown',
    direction: 'UNKNOWN',
    symbol: null,
    entryPrice: null,
    stopLoss: null,
    takeProfits: [],
    rawText: text,
    confidence: 0,
    isLimitOrder: false,
  };
}

export function isTelegramLimitOrderSignal(signal: ParsedTelegramSignal): boolean {
  return signal.isLimitOrder;
}
