/**
 * Smart Money Concepts engine — detects order blocks, fair value gaps,
 * liquidity pools, premium/discount zones, equal highs/lows and liquidity
 * sweeps from REAL MT5 candles.
 *
 * Returns status: 'insufficient_data' (never a fake "No valid POI") when the
 * underlying candles are missing.
 */

import type { Mt5Candle, TimeframeCandleResult } from './mt5Candles.service.js';

export interface Zone {
  type: 'supply' | 'demand';
  low: number;
  high: number;
  mid: number;
  time: string;
  distancePct: number | null; // distance from current price, %
}

export interface LiquidityLevel {
  price: number;
  kind: 'buy-side' | 'sell-side';
  label: string; // e.g. "Equal highs", "Prior swing high"
  time: string;
}

export interface FVG {
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  time: string;
  filled: boolean;
}

export interface OrderBlock {
  direction: 'bullish' | 'bearish';
  low: number;
  high: number;
  time: string;
  mitigated: boolean;
}

export interface SmartMoneyAnalysis {
  status: 'ok' | 'insufficient_data';
  timeframe: string;
  currentPrice: number | null;
  nearestSupply: Zone | null;
  nearestDemand: Zone | null;
  buySideLiquidity: LiquidityLevel[];
  sellSideLiquidity: LiquidityLevel[];
  activeFVGs: FVG[];
  orderBlocks: OrderBlock[];
  premiumDiscount: {
    rangeHigh: number;
    rangeLow: number;
    equilibrium: number;
    zone: 'premium' | 'discount' | 'equilibrium';
  } | null;
  recentSweep: {
    direction: 'buy-side' | 'sell-side';
    price: number;
    time: string;
    explanation: string;
  } | null;
  explanation: string;
  reason?: string;
}

const MIN_CANDLES_FOR_SMC = 60;

function pct(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

/** Fair value gaps: 3-candle imbalance where candle1.high < candle3.low (bullish) or candle1.low > candle3.high (bearish). */
function detectFVGs(candles: Mt5Candle[], currentPrice: number): FVG[] {
  const fvgs: FVG[] = [];
  for (let i = 2; i < candles.length; i += 1) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c1.high < c3.low) {
      const gapTop = c3.low;
      const gapBottom = c1.high;
      // filled if price has since traded back below the gap top
      const filled = candles.slice(i + 1).some((c) => c.low <= gapBottom);
      fvgs.push({ direction: 'bullish', top: gapTop, bottom: gapBottom, time: c3.time, filled });
    } else if (c1.low > c3.high) {
      const gapTop = c1.low;
      const gapBottom = c3.high;
      const filled = candles.slice(i + 1).some((c) => c.high >= gapTop);
      fvgs.push({ direction: 'bearish', top: gapTop, bottom: gapBottom, time: c3.time, filled });
    }
  }
  // Keep unfilled gaps near current price, most recent first.
  return fvgs
    .filter((f) => !f.filled)
    .filter((f) => Math.abs(pct(currentPrice, (f.top + f.bottom) / 2)) < 5)
    .slice(-6)
    .reverse();
}

/** Order blocks: last opposite candle before an impulsive move that breaks structure. */
function detectOrderBlocks(candles: Mt5Candle[], atr: number): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  for (let i = 1; i < candles.length - 1; i += 1) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const next = candles[i + 1];
    const move = next.close - cur.close;
    const impulsive = Math.abs(move) > atr * 1.2;
    if (!impulsive) continue;

    // Bullish OB: a down candle immediately before a strong up move.
    if (move > 0 && cur.close < cur.open) {
      const mitigated = candles.slice(i + 2).some((c) => c.low <= cur.low);
      blocks.push({ direction: 'bullish', low: cur.low, high: cur.high, time: cur.time, mitigated });
    }
    // Bearish OB: an up candle immediately before a strong down move.
    if (move < 0 && cur.close > cur.open) {
      const mitigated = candles.slice(i + 2).some((c) => c.high >= cur.high);
      blocks.push({ direction: 'bearish', low: cur.low, high: cur.high, time: cur.time, mitigated });
    }
    void prev;
  }
  return blocks.filter((b) => !b.mitigated).slice(-6).reverse();
}

/** Equal highs / lows = liquidity pools. Cluster swing extremes within a tolerance. */
function detectEqualLevels(candles: Mt5Candle[], atr: number): { buySide: LiquidityLevel[]; sellSide: LiquidityLevel[] } {
  const tolerance = atr * 0.25;
  const highs: { price: number; time: string }[] = [];
  const lows: { price: number; time: string }[] = [];
  const w = 2;
  for (let i = w; i < candles.length - w; i += 1) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ price: c.high, time: c.time });
    if (isLow) lows.push({ price: c.low, time: c.time });
  }

  const buySide: LiquidityLevel[] = [];
  const sellSide: LiquidityLevel[] = [];

  // Equal highs (buy-side liquidity sits above)
  for (let i = 1; i < highs.length; i += 1) {
    if (Math.abs(highs[i].price - highs[i - 1].price) <= tolerance) {
      buySide.push({ price: Math.max(highs[i].price, highs[i - 1].price), kind: 'buy-side', label: 'Equal highs', time: highs[i].time });
    }
  }
  // Equal lows (sell-side liquidity sits below)
  for (let i = 1; i < lows.length; i += 1) {
    if (Math.abs(lows[i].price - lows[i - 1].price) <= tolerance) {
      sellSide.push({ price: Math.min(lows[i].price, lows[i - 1].price), kind: 'sell-side', label: 'Equal lows', time: lows[i].time });
    }
  }

  // Add the most recent prior swing high/low as standing liquidity.
  if (highs.length) buySide.push({ price: highs[highs.length - 1].price, kind: 'buy-side', label: 'Prior swing high', time: highs[highs.length - 1].time });
  if (lows.length) sellSide.push({ price: lows[lows.length - 1].price, kind: 'sell-side', label: 'Prior swing low', time: lows[lows.length - 1].time });

  return { buySide: buySide.slice(-5), sellSide: sellSide.slice(-5) };
}

function detectSweep(candles: Mt5Candle[], liquidity: { buySide: LiquidityLevel[]; sellSide: LiquidityLevel[] }): SmartMoneyAnalysis['recentSweep'] {
  const lookback = candles.slice(-6);
  if (lookback.length < 2) return null;

  // Buy-side sweep: wick takes out a buy-side level then closes back below it.
  for (const lvl of liquidity.buySide) {
    const sweepBar = lookback.find((c) => c.high > lvl.price && c.close < lvl.price);
    if (sweepBar) {
      return {
        direction: 'buy-side',
        price: lvl.price,
        time: sweepBar.time,
        explanation: `Price swept buy-side liquidity at ${lvl.price.toFixed(2)} (${lvl.label}) and rejected — potential bearish reaction.`,
      };
    }
  }
  for (const lvl of liquidity.sellSide) {
    const sweepBar = lookback.find((c) => c.low < lvl.price && c.close > lvl.price);
    if (sweepBar) {
      return {
        direction: 'sell-side',
        price: lvl.price,
        time: sweepBar.time,
        explanation: `Price swept sell-side liquidity at ${lvl.price.toFixed(2)} (${lvl.label}) and reclaimed — potential bullish reaction.`,
      };
    }
  }
  return null;
}

function obToZone(blocks: OrderBlock[], currentPrice: number): { supply: Zone | null; demand: Zone | null } {
  let supply: Zone | null = null;
  let demand: Zone | null = null;

  // Nearest bearish OB above price = supply; nearest bullish OB below price = demand.
  const supplies = blocks
    .filter((b) => b.direction === 'bearish' && b.high >= currentPrice)
    .sort((a, b) => a.low - b.low);
  const demands = blocks
    .filter((b) => b.direction === 'bullish' && b.low <= currentPrice)
    .sort((a, b) => b.high - a.high);

  if (supplies[0]) {
    supply = { type: 'supply', low: supplies[0].low, high: supplies[0].high, mid: (supplies[0].low + supplies[0].high) / 2, time: supplies[0].time, distancePct: pct(currentPrice, supplies[0].low) };
  }
  if (demands[0]) {
    demand = { type: 'demand', low: demands[0].low, high: demands[0].high, mid: (demands[0].low + demands[0].high) / 2, time: demands[0].time, distancePct: pct(currentPrice, demands[0].high) };
  }
  return { supply, demand };
}

function computeATR(candles: Mt5Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!prev) continue;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  return trs.length ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
}

/**
 * Run SMC on an entry timeframe (typically M15 or H1). Pass the candle result
 * for that timeframe plus the current price.
 */
export function buildSmartMoneyAnalysis(
  candleResult: TimeframeCandleResult,
  currentPrice: number | null,
): SmartMoneyAnalysis {
  const candles = candleResult.candles;
  const price = currentPrice ?? candles[candles.length - 1]?.close ?? null;

  if (candleResult.status !== 'ok' || candles.length < MIN_CANDLES_FOR_SMC || price == null) {
    return {
      status: 'insufficient_data',
      timeframe: candleResult.timeframe,
      currentPrice: price,
      nearestSupply: null,
      nearestDemand: null,
      buySideLiquidity: [],
      sellSideLiquidity: [],
      activeFVGs: [],
      orderBlocks: [],
      premiumDiscount: null,
      recentSweep: null,
      explanation: `Smart Money analysis needs at least ${MIN_CANDLES_FOR_SMC} ${candleResult.timeframe} MT5 candles.`,
      reason: candleResult.message
        ?? `Only ${candleResult.available} ${candleResult.timeframe} candles available; need ${MIN_CANDLES_FOR_SMC}+. Open the chart in MT5 to download history.`,
    };
  }

  const atr = computeATR(candles) || price * 0.001;
  const fvgs = detectFVGs(candles, price);
  const orderBlocks = detectOrderBlocks(candles, atr);
  const liquidity = detectEqualLevels(candles, atr);
  const { supply, demand } = obToZone(orderBlocks, price);
  const sweep = detectSweep(candles, liquidity);

  // Premium/discount over the recent dealing range (last 50 bars).
  const range = candles.slice(-50);
  const rangeHigh = Math.max(...range.map((c) => c.high));
  const rangeLow = Math.min(...range.map((c) => c.low));
  const equilibrium = (rangeHigh + rangeLow) / 2;
  let zone: 'premium' | 'discount' | 'equilibrium';
  const eqBand = (rangeHigh - rangeLow) * 0.05;
  if (price > equilibrium + eqBand) zone = 'premium';
  else if (price < equilibrium - eqBand) zone = 'discount';
  else zone = 'equilibrium';

  // Build an honest explanation of whether a clean setup exists.
  const parts: string[] = [];
  if (sweep) {
    parts.push(sweep.explanation);
  }
  if (supply && demand) {
    parts.push(`Price sits between demand ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} and supply ${supply.low.toFixed(2)}–${supply.high.toFixed(2)}.`);
  } else if (demand) {
    parts.push(`Nearest demand is ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} below price.`);
  } else if (supply) {
    parts.push(`Nearest supply is ${supply.low.toFixed(2)}–${supply.high.toFixed(2)} above price.`);
  }
  parts.push(`Price is in the ${zone} zone of the recent ${candleResult.timeframe} range.`);
  if (fvgs.length) {
    parts.push(`${fvgs.length} unfilled FVG${fvgs.length > 1 ? 's' : ''} nearby — possible retest target${fvgs.length > 1 ? 's' : ''}.`);
  }
  if (!sweep && zone === 'equilibrium' && !fvgs.length) {
    parts.push('No confirmed setup: price is mid-range with no fresh liquidity sweep or FVG retest present.');
  }

  return {
    status: 'ok',
    timeframe: candleResult.timeframe,
    currentPrice: price,
    nearestSupply: supply,
    nearestDemand: demand,
    buySideLiquidity: liquidity.buySide,
    sellSideLiquidity: liquidity.sellSide,
    activeFVGs: fvgs,
    orderBlocks,
    premiumDiscount: { rangeHigh, rangeLow, equilibrium, zone },
    recentSweep: sweep,
    explanation: parts.join(' '),
  };
}
