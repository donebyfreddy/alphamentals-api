import type { MetaTraderAccountSnapshot, MetaTraderHistoryDeal, MetaTraderPosition } from './metaTrader.service.js';

export interface NormalizedMt5ClosedTrade {
  externalTradeId: string;
  externalOrderId: string | null;
  externalPositionId: string | null;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  volume: number;
  entryPrice: number;
  closePrice: number | null;
  openTime: string | null;
  closeTime: string | null;
  profit: number;
  commission: number;
  swap: number;
  comment: string | null;
  rawDeals: MetaTraderHistoryDeal[];
}

export interface NormalizedMt5OpenTrade {
  externalTradeId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  openTime: string | null;
  profit: number;
  rawPosition: MetaTraderPosition;
}

export interface Mt5TradeAnalysis {
  pnl: number;
  pnlPercent: number | null;
  pnlPips: number | null;
  rrActual: number | null;
  durationMinutes: number | null;
  session: 'LONDON' | 'NEW_YORK' | 'ASIA' | 'LONDON_NY_OVERLAP' | 'CUSTOM';
  result: 'win' | 'loss' | 'breakeven';
  aiReview: string;
}

function toIsoString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positionKey(deal: MetaTraderHistoryDeal): string {
  return deal.positionId || deal.order || deal.ticket;
}

function numericOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeOpenPositions(positions: MetaTraderPosition[]): NormalizedMt5OpenTrade[] {
  return positions
    .filter((position) => position.ticket && position.symbol)
    .map((position) => ({
      externalTradeId: position.ticket,
      symbol: position.symbol.toUpperCase(),
      direction: position.type === 'buy' ? 'LONG' : 'SHORT',
      volume: numericOrZero(position.volume),
      entryPrice: numericOrZero(position.openPrice),
      currentPrice: position.currentPrice ?? null,
      openTime: toIsoString(position.openedAt),
      profit: numericOrZero(position.profit),
      rawPosition: position,
    }));
}

export function normalizeClosedTrades(history: MetaTraderHistoryDeal[]): NormalizedMt5ClosedTrade[] {
  const grouped = new Map<string, MetaTraderHistoryDeal[]>();

  history
    .filter((deal) => deal.symbol && numericOrZero(deal.volume) > 0)
    .forEach((deal) => {
      const key = positionKey(deal);
      const existing = grouped.get(key) ?? [];
      existing.push(deal);
      grouped.set(key, existing);
    });

  return Array.from(grouped.entries())
    .map(([key, deals]) => {
      const sorted = [...deals].sort((a, b) => {
        const aTime = new Date(a.time ?? 0).getTime();
        const bTime = new Date(b.time ?? 0).getTime();
        return aTime - bTime;
      });

      const entryDeal = sorted.find((deal) => deal.entryType === 0) ?? sorted[0];
      const exitCandidates = sorted.filter((deal) => deal.entryType === 1);
      const exitDeal = exitCandidates.at(-1) ?? null;

      if (!entryDeal || !exitDeal) return null;

      const totalProfit = sorted.reduce((sum, deal) => sum + numericOrZero(deal.profit), 0);
      const totalCommission = sorted.reduce((sum, deal) => sum + numericOrZero(deal.commission), 0);
      const totalSwap = sorted.reduce((sum, deal) => sum + numericOrZero(deal.swap), 0);

      return {
        externalTradeId: key,
        externalOrderId: entryDeal.order ?? null,
        externalPositionId: entryDeal.positionId ?? null,
        symbol: entryDeal.symbol.toUpperCase(),
        direction: entryDeal.type === 'buy' ? 'LONG' : 'SHORT',
        volume: numericOrZero(entryDeal.volume),
        entryPrice: numericOrZero(entryDeal.price),
        closePrice: exitDeal.price ?? null,
        openTime: toIsoString(entryDeal.time),
        closeTime: toIsoString(exitDeal.time),
        profit: totalProfit,
        commission: totalCommission,
        swap: totalSwap,
        comment: exitDeal.comment ?? entryDeal.comment ?? null,
        rawDeals: sorted,
      } satisfies NormalizedMt5ClosedTrade;
    })
    .filter((trade): trade is NormalizedMt5ClosedTrade => Boolean(trade));
}

export function inferTradingSession(timestamp: string | null): Mt5TradeAnalysis['session'] {
  if (!timestamp) return 'CUSTOM';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'CUSTOM';
  const hour = date.getUTCHours();

  if (hour >= 7 && hour < 12) return 'LONDON';
  if (hour >= 12 && hour < 16) return 'LONDON_NY_OVERLAP';
  if (hour >= 16 && hour < 21) return 'NEW_YORK';
  return 'ASIA';
}

export function estimatePips(symbol: string, direction: 'LONG' | 'SHORT', entryPrice: number, closePrice: number | null): number | null {
  if (closePrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(closePrice)) return null;
  const move = direction === 'LONG' ? closePrice - entryPrice : entryPrice - closePrice;
  const upper = symbol.toUpperCase();
  let pipSize: number;
  if (upper.endsWith('JPY')) {
    pipSize = 0.01;
  } else if (upper === 'XAUUSD') {
    pipSize = 0.1;
  } else if (upper === 'BTCUSD' || upper === 'US30') {
    pipSize = 1;
  } else {
    pipSize = 0.0001;
  }
  return Number((move / pipSize).toFixed(2));
}

export function buildTradeAnalysis(input: {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  closePrice: number | null;
  profit: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openTime: string | null;
  closeTime: string | null;
  account?: MetaTraderAccountSnapshot | null;
}): Mt5TradeAnalysis {
  const pnl = Number(input.profit.toFixed(2));
  const pnlPercent = input.account?.balance
    ? Number(((pnl / input.account.balance) * 100).toFixed(3))
    : null;
  const pnlPips = estimatePips(input.symbol, input.direction, input.entryPrice, input.closePrice);
  const risk = input.stopLoss == null ? 0 : Math.abs(input.entryPrice - input.stopLoss);
  const reward = input.closePrice == null ? 0 : Math.abs(input.closePrice - input.entryPrice);
  const rrActual = risk > 0 ? Number((reward / risk).toFixed(2)) : null;
  const durationMinutes = input.openTime && input.closeTime
    ? Math.max(0, Math.round((new Date(input.closeTime).getTime() - new Date(input.openTime).getTime()) / 60000))
    : null;
  const session = inferTradingSession(input.openTime);
  let result: Mt5TradeAnalysis['result'];
  if (pnl > 0) {
    result = 'win';
  } else if (pnl < 0) {
    result = 'loss';
  } else {
    result = 'breakeven';
  }

  const pipsLine = pnlPips == null ? 'Pip distance unavailable for this instrument.' : `Price moved ${pnlPips} pips.`;
  const durationLine = durationMinutes == null ? 'Duration unavailable.' : `Trade held for ${durationMinutes} minutes.`;
  const rrLine = rrActual == null ? 'R:R unavailable — no stop loss was synced.' : `Realized R:R was ${rrActual}.`;
  const sessionLine = `Session at open: ${session.replace('_', '/')}.`;

  const aiReview = [
    `MT5 trade on ${input.symbol} ${input.direction}.`,
    pipsLine,
    durationLine,
    rrLine,
    sessionLine,
  ].join(' ');

  return {
    pnl,
    pnlPercent,
    pnlPips,
    rrActual,
    durationMinutes,
    session,
    result,
    aiReview,
  };
}
