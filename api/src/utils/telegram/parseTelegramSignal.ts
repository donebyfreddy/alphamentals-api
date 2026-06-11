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

// ---------------------------------------------------------------------------
// Symbol detection
// ---------------------------------------------------------------------------

const SYMBOL_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:XAU[\s/_-]?USD|GOLD)\b/i,    'XAUUSD'],
  [/\b(?:XAG[\s/_-]?USD|SILVER)\b/i,  'XAGUSD'],
  [/\bGBP[\s/_-]?USD\b/i,             'GBPUSD'],
  [/\bEUR[\s/_-]?USD\b/i,             'EURUSD'],
  [/\bUSD[\s/_-]?JPY\b/i,             'USDJPY'],
  [/\bAUD[\s/_-]?USD\b/i,             'AUDUSD'],
  [/\bUSD[\s/_-]?CAD\b/i,             'USDCAD'],
  [/\bNZD[\s/_-]?USD\b/i,             'NZDUSD'],
  [/\bUSD[\s/_-]?CHF\b/i,             'USDCHF'],
  [/\bEUR[\s/_-]?GBP\b/i,             'EURGBP'],
  [/\bEUR[\s/_-]?JPY\b/i,             'EURJPY'],
  [/\bGBP[\s/_-]?JPY\b/i,             'GBPJPY'],
  [/\bGBP[\s/_-]?AUD\b/i,             'GBPAUD'],
  [/\bEUR[\s/_-]?AUD\b/i,             'EURAUD'],
  [/\bCHF[\s/_-]?JPY\b/i,             'CHFJPY'],
  [/\bBTC[\s/_-]?USD\b/i,             'BTCUSD'],
  [/\bETH[\s/_-]?USD\b/i,             'ETHUSD'],
  [/\bUS30\b/i,                        'US30'],
  [/\bNAS100\b/i,                      'NAS100'],
  [/\bSP500\b/i,                       'SP500'],
];

function detectSymbol(text: string): string | null {
  for (const [pattern, canonical] of SYMBOL_ALIASES) {
    if (pattern.test(text)) return canonical;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direction + order type
// ---------------------------------------------------------------------------

type DirectionResult = { direction: TelegramSignalDirection; orderType: string };

function detectDirectionAndOrderType(text: string): DirectionResult {
  if (/\bBUY\s+LIMIT\b/i.test(text))  return { direction: 'BUY',  orderType: 'LIMIT'  };
  if (/\bSELL\s+LIMIT\b/i.test(text)) return { direction: 'SELL', orderType: 'LIMIT'  };
  if (/\bBUY\s+STOP\b/i.test(text))   return { direction: 'BUY',  orderType: 'STOP'   };
  if (/\bSELL\s+STOP\b/i.test(text))  return { direction: 'SELL', orderType: 'STOP'   };
  if (/\bBUY\b/i.test(text) || /\bLONG\b/i.test(text))   return { direction: 'BUY',  orderType: 'MARKET' };
  if (/\bSELL\b/i.test(text) || /\bSHORT\b/i.test(text)) return { direction: 'SELL', orderType: 'MARKET' };
  return { direction: 'UNKNOWN', orderType: '' };
}

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

function extractNumber(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    // "LABEL: 3180" or "LABEL 3180" or "LABEL @ 3180" or "LABEL= 3180"
    const pattern = new RegExp(String.raw`\b` + escaped + String.raw`\b\s*[-:\s@=]?\s*(\d{1,7}(?:[.,]\d{1,5})?)`, 'i');
    const m = pattern.exec(text);
    if (m?.[1]) {
      const v = Number.parseFloat(m[1].replace(',', '.'));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

// "@ 3180" pattern that appears after order type line
function extractAtPrice(text: string): number | null {
  const m = /@\s*(\d{3,7}(?:[.,]\d{1,5})?)/.exec(text);
  if (m?.[1]) {
    const v = Number.parseFloat(m[1].replace(',', '.'));
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function extractTakeProfits(text: string): number[] {
  const results: number[] = [];

  // TP1: 3195, TP2: 3215 …
  const numbered = /\bTP\s*(\d)\s*[:\s@=]+\s*(\d{1,7}(?:[.,]\d{1,5})?)/gi;
  const indexed: Array<{ n: number; v: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = numbered.exec(text)) !== null) {
    const v = Number.parseFloat(m[2].replace(',', '.'));
    if (Number.isFinite(v) && v > 0) indexed.push({ n: Number.parseInt(m[1], 10), v });
  }
  if (indexed.length > 0) {
    const sorted = [...indexed].sort((a, b) => a.n - b.n);
    return sorted.map((x) => x.v);
  }

  // Single TP: 3200
  const single = extractNumber(text, ['TP', 'TAKE PROFIT', 'TARGET', 'T/P']);
  if (single !== null) results.push(single);

  return results;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

function makeUnknown(text: string): ParsedTelegramSignal {
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

export function parseTelegramSignal(text: string, _context?: unknown): ParsedTelegramSignal {
  if (!text || typeof text !== 'string') return makeUnknown(text ?? '');

  const symbol = detectSymbol(text);
  const { direction, orderType } = detectDirectionAndOrderType(text);

  if (direction === 'UNKNOWN' || symbol === null) {
    return makeUnknown(text);
  }

  const entry =
    extractNumber(text, ['ENTRY', 'ENTER', 'PRICE', 'ENTRY PRICE', 'LIMIT']) ??
    extractAtPrice(text);

  const stopLoss = extractNumber(text, ['SL', 'STOP LOSS', 'STOP', 'S/L', 'S.L', 'STOPLOSS']);
  const takeProfits = extractTakeProfits(text);
  const takeProfit = takeProfits[0] ?? null;
  const isLimitOrder = orderType === 'LIMIT';

  return {
    messageType: 'SIGNAL',
    type: 'SIGNAL',
    direction,
    symbol,
    entry,
    entryPrice: entry,
    stopLoss,
    takeProfit,
    takeProfits,
    orderType,
    timeframe: null,
    rawText: text,
    confidence: isLimitOrder ? 85 : 70,
    isLimitOrder,
  };
}

// ---------------------------------------------------------------------------
// Limit-order guard (used by filters)
// ---------------------------------------------------------------------------

export function isTelegramLimitOrderSignal(
  textOrSignal: unknown,
  _signal?: Pick<ParsedTelegramSignal, 'messageType' | 'direction'>,
): boolean {
  let text = '';
  if (typeof textOrSignal === 'string') {
    text = textOrSignal;
  } else if (typeof (textOrSignal as { rawText?: string })?.rawText === 'string') {
    text = (textOrSignal as { rawText: string }).rawText;
  }
  if (!text) return false;
  return /\b(BUY|SELL)\s+LIMIT\b/i.test(text);
}
