/**
 * Pair intelligence orchestrator.
 *
 * Combines (all MT5-backed where technical):
 *   - price snapshot (movement from MT5 D1 reference)
 *   - market structure (MT5 candles per timeframe)
 *   - smart money concepts (MT5 candles)
 *   - AI fundamental analysis (news/calendar/macro/telegram)
 * into a single PairIntelligence object with a confluence score and a
 * setup decision, then persists it (local JSON fallback).
 */

import {
  getMt5CandleBundle,
  getMt5BridgeStatus,
  REQUIRED_CANDLES,
  ALL_TIMEFRAMES,
  type Mt5Timeframe,
  type SymbolCandleBundle,
} from './mt5Candles.service.js';
import { buildMarketStructure, type MarketStructureResult } from './marketStructure.service.js';
import { buildSmartMoneyAnalysis, type SmartMoneyAnalysis } from './smcAnalysis.service.js';
import { buildPriceSnapshot, type PriceSnapshot } from './mt5PriceSnapshot.service.js';
import { buildPairFundamentalAnalysis, type PairFundamentalAnalysis, normalizePair } from './pairFundamentalsAi.service.js';
import { savePairIntelligence } from './pairIntelligencePersistence.service.js';

export type SetupStatus = 'wait' | 'watch' | 'long_bias' | 'short_bias' | 'blocked';

export interface PairDiagnostics {
  symbol: string;
  price: { available: boolean; source: string | null; lastTickAt: string | null };
  mt5: { bridgeReachable: boolean; terminalConnected: boolean; accountLogin: string | null; server: string | null };
  candles: Record<Mt5Timeframe, { available: number; required: number; ok: boolean }>;
  fundamentals: { lastRunAt: string | null; mode: string; sourcesUsed: string[]; warnings: string[] };
  generatedAt: string;
}

export interface PairIntelligence {
  ok: boolean;
  symbol: string;
  price: PriceSnapshot;
  fundamentals: PairFundamentalAnalysis;
  structure: {
    alignmentScore: number;
    overallDirection: MarketStructureResult['overallDirection'];
    timeframes: MarketStructureResult['timeframes'];
    explanation: string;
  };
  smc: SmartMoneyAnalysis;
  setupDecision: {
    status: SetupStatus;
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    grade: 'A' | 'B' | 'C' | 'D';
    reason: string;
    whatMustHappenNext: string[];
    invalidation: string | null;
  };
  confluence: {
    technicalScore: number;
    fundamentalScore: number;
    smcScore: number;
    riskScore: number;
    totalScore: number;
    explanation: string;
  };
  diagnostics: PairDiagnostics;
  generatedAt: string;
}

function dirToSign(d: string): number {
  if (d === 'bullish') return 1;
  if (d === 'bearish') return -1;
  return 0;
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 78) return 'A';
  if (score >= 62) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

function buildConfluence(
  structure: MarketStructureResult,
  smc: SmartMoneyAnalysis,
  fundamentals: PairFundamentalAnalysis,
  price: PriceSnapshot,
) {
  // Technical score: structure alignment, scaled by whether any TF is usable.
  const usableTfs = structure.timeframes.filter((t) => t.status === 'ok').length;
  const technicalScore = usableTfs === 0 ? 0 : structure.alignmentScore;

  // Fundamental score: confidence, signed by bias agreement is handled later.
  const fundamentalScore = fundamentals.confidence;

  // SMC score: presence of a fresh sweep / clean zone proximity.
  let smcScore = 0;
  if (smc.status === 'ok') {
    if (smc.recentSweep) smcScore += 40;
    if (smc.nearestDemand && smc.premiumDiscount?.zone === 'discount') smcScore += 25;
    if (smc.nearestSupply && smc.premiumDiscount?.zone === 'premium') smcScore += 25;
    if (smc.activeFVGs.length) smcScore += 15;
    smcScore = Math.min(100, smcScore || 20);
  }

  // Risk score: lower when data is stale or price reference missing.
  let riskScore = 70;
  if (fundamentals.dataFreshness.isStale) riskScore -= 25;
  if (!price.ok) riskScore -= 25;
  if (usableTfs < 3) riskScore -= 20;
  riskScore = Math.max(0, riskScore);

  const totalScore = Math.round(
    technicalScore * 0.35 + fundamentalScore * 0.30 + smcScore * 0.20 + riskScore * 0.15,
  );

  const explanation = `Technical ${technicalScore}/100 · Fundamental ${fundamentalScore}/100 · SMC ${smcScore}/100 · Risk ${riskScore}/100 → total ${totalScore}/100.`;

  return { technicalScore, fundamentalScore, smcScore, riskScore, totalScore, explanation };
}

function buildSetupDecision(
  structure: MarketStructureResult,
  fundamentals: PairFundamentalAnalysis,
  smc: SmartMoneyAnalysis,
  confluence: ReturnType<typeof buildConfluence>,
): PairIntelligence['setupDecision'] {
  const usableTfs = structure.timeframes.filter((t) => t.status === 'ok').length;

  // If we have no technical data at all, never pretend a setup exists.
  if (usableTfs === 0) {
    return {
      status: 'blocked',
      direction: 'neutral',
      confidence: 0,
      grade: 'D',
      reason: 'No MT5 candle data available — technical confirmation is impossible. Open the charts in MT5 on the VPS.',
      whatMustHappenNext: ['Start the MT5 Python bridge', 'Open W1/D1/H4/H1/M15/M5 charts in MT5 to download history'],
      invalidation: null,
    };
  }

  const techSign = dirToSign(structure.overallDirection);
  const fundSign = dirToSign(fundamentals.bias);

  let status: SetupStatus;
  let direction: 'bullish' | 'bearish' | 'neutral';
  let reason: string;
  const next: string[] = [];

  if (techSign !== 0 && techSign === fundSign) {
    // Aligned
    direction = techSign > 0 ? 'bullish' : 'bearish';
    status = techSign > 0 ? 'long_bias' : 'short_bias';
    reason = `Structure (${structure.overallDirection}) and fundamentals (${fundamentals.bias}) agree. ${confluence.explanation}`;
    if (smc.recentSweep) next.push(`Confirm entry off the ${smc.recentSweep.direction} sweep at ${smc.recentSweep.price.toFixed(2)}.`);
    else next.push('Wait for a liquidity sweep or FVG retest on M15/M5 to time entry.');
  } else if (techSign !== 0 && fundSign !== 0 && techSign !== fundSign) {
    // Conflict
    status = 'wait';
    direction = 'neutral';
    reason = `Conflict: structure is ${structure.overallDirection} but fundamentals are ${fundamentals.bias}. Stand aside until they align.`;
    next.push('Wait for structure and fundamentals to agree.');
    next.push(fundamentals.invalidation || 'Watch the next high-impact catalyst.');
  } else if (techSign !== 0) {
    // Technical only
    status = 'watch';
    direction = techSign > 0 ? 'bullish' : 'bearish';
    reason = `Structure leans ${structure.overallDirection}; fundamentals are ${fundamentals.bias}/low-conviction. Trade with reduced size.`;
    next.push('Look for a fundamental catalyst to confirm the technical lean.');
  } else if (fundSign !== 0) {
    // Fundamental only
    status = 'watch';
    direction = fundSign > 0 ? 'bullish' : 'bearish';
    reason = `Fundamentals lean ${fundamentals.bias}; structure is ${structure.overallDirection}. Wait for structure to confirm.`;
    next.push('Wait for a break of structure in the fundamental direction.');
  } else {
    status = 'wait';
    direction = 'neutral';
    reason = `Both structure and fundamentals are neutral/mixed. ${confluence.explanation}`;
    next.push('No edge right now — wait for a clearer signal.');
  }

  const confidence = Math.round((confluence.totalScore + fundamentals.confidence) / 2);

  return {
    status,
    direction,
    confidence,
    grade: gradeFromScore(confluence.totalScore),
    reason,
    whatMustHappenNext: next,
    invalidation: fundamentals.invalidation || null,
  };
}

function buildDiagnostics(
  symbol: string,
  price: PriceSnapshot,
  bundle: SymbolCandleBundle,
  bridgeStatus: Awaited<ReturnType<typeof getMt5BridgeStatus>>,
  fundamentals: PairFundamentalAnalysis,
): PairDiagnostics {
  const candles = {} as PairDiagnostics['candles'];
  for (const tf of ALL_TIMEFRAMES) {
    const r = bundle.timeframes[tf];
    candles[tf] = {
      available: r?.available ?? 0,
      required: REQUIRED_CANDLES[tf],
      ok: (r?.status ?? 'error') === 'ok',
    };
  }

  return {
    symbol,
    price: { available: price.ok, source: price.source, lastTickAt: price.lastTickAt },
    mt5: {
      bridgeReachable: bridgeStatus.bridgeReachable,
      terminalConnected: bridgeStatus.terminalConnected,
      accountLogin: bridgeStatus.accountLogin,
      server: bridgeStatus.server,
    },
    candles,
    fundamentals: {
      lastRunAt: fundamentals.generatedAt,
      mode: fundamentals.mode,
      sourcesUsed: [
        ...(fundamentals.newsEvidence.length ? ['news'] : []),
        ...(fundamentals.keyCatalysts.length ? ['calendar'] : []),
        ...(fundamentals.dataFreshness.telegramLatestAt ? ['telegram'] : []),
      ],
      warnings: fundamentals.dataFreshness.warnings,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildPairIntelligence(
  symbol: string,
  options?: { forceRefresh?: boolean },
): Promise<PairIntelligence> {
  const pair = normalizePair(symbol);
  const generatedAt = new Date().toISOString();

  // Run independent fetches in parallel.
  const [bundle, bridgeStatus, price, fundamentals] = await Promise.all([
    getMt5CandleBundle(pair, { forceRefresh: options?.forceRefresh }),
    getMt5BridgeStatus(),
    buildPriceSnapshot(pair, { forceRefresh: options?.forceRefresh }),
    buildPairFundamentalAnalysis(pair, { forceRefresh: options?.forceRefresh }),
  ]);

  const structure = buildMarketStructure(pair, ALL_TIMEFRAMES.map((tf) => bundle.timeframes[tf]));

  // SMC on the H1 entry timeframe (fallback to M15 if H1 is thin).
  const smcTf = bundle.timeframes.H1.status === 'ok' ? bundle.timeframes.H1 : bundle.timeframes.M15;
  const smc = buildSmartMoneyAnalysis(smcTf, price.price);

  const confluence = buildConfluence(structure, smc, fundamentals, price);
  const setupDecision = buildSetupDecision(structure, fundamentals, smc, confluence);
  const diagnostics = buildDiagnostics(pair, price, bundle, bridgeStatus, fundamentals);

  const intelligence: PairIntelligence = {
    ok: true,
    symbol: pair,
    price,
    fundamentals,
    structure: {
      alignmentScore: structure.alignmentScore,
      overallDirection: structure.overallDirection,
      timeframes: structure.timeframes,
      explanation: structure.explanation,
    },
    smc,
    setupDecision,
    confluence,
    diagnostics,
    generatedAt,
  };

  // Persist (best-effort, non-blocking).
  void savePairIntelligence(pair, intelligence)
    .catch((e) => console.warn(`[pair-intelligence] persist failed for ${pair}:`, e instanceof Error ? e.message : e));

  console.info(`[pair-intelligence] ${pair}: decision=${setupDecision.status} grade=${setupDecision.grade} total=${confluence.totalScore} bridge=${bridgeStatus.bridgeReachable} terminal=${bridgeStatus.terminalConnected}`);
  return intelligence;
}
