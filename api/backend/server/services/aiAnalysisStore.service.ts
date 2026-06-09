import { supabase, isDatabaseConfigured } from '../lib/supabase.js';
import { DEFAULT_SYMBOLS } from '../../../src/lib/symbolConfig.js';
import { getDisplayName, normalizeApiSymbol, normalizeDisplaySymbol } from '../../../src/services/pairs/symbolNormalizer.js';

const EXTRA_AI_ANALYSIS_SYMBOLS = ['DXY', 'USOIL', 'NAS100', 'SPX500'] as const;

export const AI_ANALYSIS_SYMBOLS = [
  ...new Set([...Object.keys(DEFAULT_SYMBOLS), ...EXTRA_AI_ANALYSIS_SYMBOLS]),
] as const;

export type AiAnalysisSymbol = typeof AI_ANALYSIS_SYMBOLS[number];
export type AiAnalysisTriggerSource = 'manual' | 'scheduled_07' | 'scheduled_13' | 'scheduled_14' | 'scheduled_15' | 'startup';

export interface SavedAiSymbolAnalysis {
  id?: string;
  analysisRunId?: string | null;
  symbol: string;
  pairName: string;
  provider: 'openai';
  model: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  tradeMode: 'favor_buys' | 'favor_sells' | 'wait' | 'avoid';
  confidence: number;
  calendarRisk: 'low' | 'medium' | 'high';
  decisionSummary: string;
  technicalSummary: string;
  fundamentalSummary: string;
  macroDrivers: string[];
  watchEvents: string[];
  riskFactors: string[];
  generatedAt: string;
  generatedTimezone: string;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource;
  isLatest: boolean;
  createdAt?: string;
  updatedAt?: string;
  summary: string;
  macroFundamentals: {
    bias: 'bullish' | 'bearish' | 'neutral';
    drivers: string[];
    reasoning: string;
  };
  economicCalendarImpact: {
    highImpactEvents: string[];
    expectedEffect: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  keyRisks: string[];
}

export interface SavedAiAnalysisPayload {
  ok: true;
  provider: 'openai';
  model: string;
  generatedAt: string;
  generatedTimezone: string;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource;
  symbols: Record<string, SavedAiSymbolAnalysis>;
}

export interface AiAnalysisRunRow {
  id: string;
  provider: string;
  model: string;
  symbols: string[];
  analysis_json: SavedAiAnalysisPayload | null;
  status: 'running' | 'success' | 'failed';
  error_message: string | null;
  generated_at: string | null;
  created_at: string;
  trigger_source: 'manual' | 'cron' | 'startup';
}

interface ModernAiFundamentalRow {
  id: string;
  ai_analysis_run_id: string | null;
  symbol: string;
  pair_name: string;
  provider: string;
  model: string;
  status: 'running' | 'completed' | 'failed';
  bias: 'bullish' | 'bearish' | 'neutral';
  trade_mode: 'favor_buys' | 'favor_sells' | 'wait' | 'avoid';
  confidence: number;
  calendar_risk: 'low' | 'medium' | 'high';
  summary: string;
  decision_summary: string;
  technical_summary: string;
  fundamental_summary: string;
  macro_drivers: string[] | null;
  watch_events: string[] | null;
  risk_factors: string[] | null;
  generated_at: string;
  completed_at: string;
  generated_timezone: string;
  source_data_timestamp: string | null;
  trigger_source: AiAnalysisTriggerSource;
  is_latest: boolean;
  analysis_json: Partial<SavedAiSymbolAnalysis> | null;
  created_at: string;
  updated_at: string;
}

interface LegacySavedAiFundamentalRow {
  id: string;
  ai_analysis_run_id: string | null;
  symbol: string;
  pair_name: string;
  provider: string;
  model: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  trade_mode: 'favor_buys' | 'favor_sells' | 'wait' | 'avoid';
  confidence: number;
  calendar_risk: 'low' | 'medium' | 'high';
  decision_summary: string;
  technical_summary: string;
  fundamental_summary: string;
  macro_drivers: string[] | null;
  watch_events: string[] | null;
  risk_factors: string[] | null;
  generated_at: string;
  generated_timezone: string;
  source_data_timestamp: string | null;
  trigger_source: AiAnalysisTriggerSource;
  is_latest: boolean;
  created_at: string;
  updated_at: string;
}

function normalizeStoredSymbol(symbol: string): string {
  return normalizeApiSymbol(symbol);
}

function uniqueNormalizedSymbols(symbols: string[]) {
  return [...new Set(symbols.map((symbol) => normalizeStoredSymbol(symbol)).filter(Boolean))];
}

function fromFlattenedRow(row: {
  id?: string;
  ai_analysis_run_id?: string | null;
  symbol: string;
  pair_name: string;
  model: string;
  bias: SavedAiSymbolAnalysis['bias'];
  trade_mode: SavedAiSymbolAnalysis['tradeMode'];
  confidence: number;
  calendar_risk: SavedAiSymbolAnalysis['calendarRisk'];
  decision_summary: string;
  technical_summary: string;
  fundamental_summary: string;
  macro_drivers: string[] | null;
  watch_events: string[] | null;
  risk_factors: string[] | null;
  generated_at: string;
  generated_timezone: string;
  source_data_timestamp: string | null;
  trigger_source: AiAnalysisTriggerSource;
  is_latest: boolean;
  created_at?: string;
  updated_at?: string;
  summary?: string;
}): SavedAiSymbolAnalysis {
  const symbol = normalizeStoredSymbol(row.symbol);
  const summary = row.summary?.trim() || row.decision_summary || row.fundamental_summary || row.technical_summary || getDisplayName(symbol);
  return {
    id: row.id,
    analysisRunId: row.ai_analysis_run_id ?? null,
    symbol,
    pairName: row.pair_name || getDisplayName(symbol),
    provider: 'openai',
    model: row.model,
    bias: row.bias,
    tradeMode: row.trade_mode,
    confidence: row.confidence,
    calendarRisk: row.calendar_risk,
    decisionSummary: row.decision_summary,
    technicalSummary: row.technical_summary,
    fundamentalSummary: row.fundamental_summary,
    macroDrivers: row.macro_drivers ?? [],
    watchEvents: row.watch_events ?? [],
    riskFactors: row.risk_factors ?? [],
    generatedAt: row.generated_at,
    generatedTimezone: row.generated_timezone,
    sourceDataTimestamp: row.source_data_timestamp,
    triggerSource: row.trigger_source,
    isLatest: row.is_latest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary,
    macroFundamentals: {
      bias: row.bias,
      drivers: row.macro_drivers ?? [],
      reasoning: row.fundamental_summary,
    },
    economicCalendarImpact: {
      highImpactEvents: row.watch_events ?? [],
      expectedEffect: row.decision_summary,
      riskLevel: row.calendar_risk,
    },
    keyRisks: row.risk_factors ?? [],
  };
}

function hydrateSavedAnalysis(row: ModernAiFundamentalRow | LegacySavedAiFundamentalRow): SavedAiSymbolAnalysis {
  const base = fromFlattenedRow({
    id: row.id,
    ai_analysis_run_id: row.ai_analysis_run_id,
    symbol: row.symbol,
    pair_name: row.pair_name,
    model: row.model,
    bias: row.bias,
    trade_mode: row.trade_mode,
    confidence: row.confidence,
    calendar_risk: row.calendar_risk,
    decision_summary: row.decision_summary,
    technical_summary: row.technical_summary,
    fundamental_summary: row.fundamental_summary,
    macro_drivers: row.macro_drivers,
    watch_events: row.watch_events,
    risk_factors: row.risk_factors,
    generated_at: row.generated_at,
    generated_timezone: row.generated_timezone,
    source_data_timestamp: row.source_data_timestamp,
    trigger_source: row.trigger_source,
    is_latest: row.is_latest,
    created_at: row.created_at,
    updated_at: row.updated_at,
    summary: 'summary' in row ? row.summary : row.decision_summary,
  });

  if (!('analysis_json' in row) || !row.analysis_json || typeof row.analysis_json !== 'object') {
    return base;
  }

  return {
    ...base,
    ...row.analysis_json,
    id: row.analysis_json.id ?? base.id,
    analysisRunId: row.analysis_json.analysisRunId ?? base.analysisRunId,
    symbol: normalizeStoredSymbol(row.analysis_json.symbol ?? base.symbol),
    pairName: row.analysis_json.pairName ?? base.pairName,
    bias: row.analysis_json.bias ?? base.bias,
    tradeMode: row.analysis_json.tradeMode ?? base.tradeMode,
    confidence: row.analysis_json.confidence ?? base.confidence,
    calendarRisk: row.analysis_json.calendarRisk ?? base.calendarRisk,
    decisionSummary: row.analysis_json.decisionSummary ?? base.decisionSummary,
    technicalSummary: row.analysis_json.technicalSummary ?? base.technicalSummary,
    fundamentalSummary: row.analysis_json.fundamentalSummary ?? base.fundamentalSummary,
    macroDrivers: row.analysis_json.macroDrivers ?? base.macroDrivers,
    watchEvents: row.analysis_json.watchEvents ?? base.watchEvents,
    riskFactors: row.analysis_json.riskFactors ?? base.riskFactors,
    generatedAt: row.analysis_json.generatedAt ?? base.generatedAt,
    generatedTimezone: row.analysis_json.generatedTimezone ?? base.generatedTimezone,
    sourceDataTimestamp: row.analysis_json.sourceDataTimestamp ?? base.sourceDataTimestamp,
    triggerSource: row.analysis_json.triggerSource ?? base.triggerSource,
    isLatest: row.analysis_json.isLatest ?? base.isLatest,
    summary: row.analysis_json.summary ?? base.summary,
    macroFundamentals: {
      bias: row.analysis_json.macroFundamentals?.bias ?? base.macroFundamentals.bias,
      drivers: row.analysis_json.macroFundamentals?.drivers ?? base.macroFundamentals.drivers,
      reasoning: row.analysis_json.macroFundamentals?.reasoning ?? base.macroFundamentals.reasoning,
    },
    economicCalendarImpact: {
      highImpactEvents: row.analysis_json.economicCalendarImpact?.highImpactEvents ?? base.economicCalendarImpact.highImpactEvents,
      expectedEffect: row.analysis_json.economicCalendarImpact?.expectedEffect ?? base.economicCalendarImpact.expectedEffect,
      riskLevel: row.analysis_json.economicCalendarImpact?.riskLevel ?? base.economicCalendarImpact.riskLevel,
    },
    keyRisks: row.analysis_json.keyRisks ?? base.keyRisks,
  };
}

function toAggregatePayload(rows: SavedAiSymbolAnalysis[]): SavedAiAnalysisPayload | null {
  if (!rows.length) return null;
  const leader = rows.reduce((latest, row) => (
    new Date(row.generatedAt).getTime() > new Date(latest.generatedAt).getTime() ? row : latest
  ), rows[0]);

  return {
    ok: true,
    provider: 'openai',
    model: leader.model,
    generatedAt: leader.generatedAt,
    generatedTimezone: leader.generatedTimezone,
    sourceDataTimestamp: leader.sourceDataTimestamp,
    triggerSource: leader.triggerSource,
    symbols: Object.fromEntries(rows.map((row) => [normalizeStoredSymbol(row.symbol), row])),
  };
}

function logStoreWarning(message: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[ai-analysis-store] ${message}: ${detail}`);
}

export function getAiAnalysisSymbols(): string[] {
  return [...AI_ANALYSIS_SYMBOLS];
}

export async function createAiAnalysisRun(input: {
  provider: string;
  model: string;
  triggerSource: 'manual' | 'cron' | 'startup';
  symbols?: string[];
}) {
  if (!isDatabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('ai_analysis_runs')
    .insert({
      provider: input.provider,
      model: input.model,
      symbols: uniqueNormalizedSymbols(input.symbols ?? getAiAnalysisSymbols()),
      status: 'running',
      trigger_source: input.triggerSource,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create AI analysis run: ${error.message}`);
  return data as AiAnalysisRunRow;
}

export async function updateAiAnalysisRun(
  id: string,
  input:
    | {
        status: 'success';
        analysis: SavedAiAnalysisPayload;
      }
    | {
        status: 'failed';
        errorMessage: string;
      },
) {
  if (!isDatabaseConfigured()) return null;

  const patch =
    input.status === 'success'
      ? {
          status: 'success',
          analysis_json: input.analysis,
          generated_at: input.analysis.generatedAt,
          error_message: null,
        }
      : {
          status: 'failed',
          error_message: input.errorMessage,
        };

  const { data, error } = await supabase
    .from('ai_analysis_runs')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update AI analysis run: ${error.message}`);
  return data as AiAnalysisRunRow;
}

async function saveToModernTable(input: {
  runId: string | null;
  provider: string;
  model: string;
  generatedAt: string;
  generatedTimezone: string;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource;
  items: SavedAiSymbolAnalysis[];
}) {
  const symbols = uniqueNormalizedSymbols(input.items.map((item) => item.symbol));
  console.info('[ai-analysis-store] saving to ai_fundamental_analyses', { symbols, runId: input.runId });

  const { error: latestError } = await supabase
    .from('ai_fundamental_analyses')
    .update({ is_latest: false })
    .in('symbol', symbols)
    .eq('is_latest', true);

  if (latestError) throw new Error(latestError.message);

  const rows = input.items.map((item) => {
    const normalizedSymbol = normalizeStoredSymbol(item.symbol);
    const hydratedItem = {
      ...item,
      symbol: normalizedSymbol,
      pairName: item.pairName || getDisplayName(normalizedSymbol),
      isLatest: true,
    };

    return {
      ai_analysis_run_id: input.runId,
      symbol: normalizedSymbol,
      pair_name: hydratedItem.pairName,
      provider: input.provider,
      model: input.model,
      status: 'completed',
      bias: hydratedItem.bias,
      trade_mode: hydratedItem.tradeMode,
      confidence: hydratedItem.confidence,
      calendar_risk: hydratedItem.calendarRisk,
      summary: hydratedItem.summary,
      decision_summary: hydratedItem.decisionSummary,
      technical_summary: hydratedItem.technicalSummary,
      fundamental_summary: hydratedItem.fundamentalSummary,
      macro_drivers: hydratedItem.macroDrivers,
      watch_events: hydratedItem.watchEvents,
      risk_factors: hydratedItem.riskFactors,
      generated_at: hydratedItem.generatedAt,
      completed_at: hydratedItem.generatedAt,
      generated_timezone: hydratedItem.generatedTimezone,
      source_data_timestamp: hydratedItem.sourceDataTimestamp,
      trigger_source: hydratedItem.triggerSource,
      is_latest: true,
      analysis_json: hydratedItem,
    };
  });

  const { data, error } = await supabase
    .from('ai_fundamental_analyses')
    .insert(rows)
    .select('*');

  if (error) throw new Error(error.message);
  const saved = (data as ModernAiFundamentalRow[] | null) ?? [];
  console.info('[ai-analysis-store] saved to ai_fundamental_analyses', {
    count: saved.length,
    ids: saved.map((r) => r.id),
    symbols: saved.map((r) => r.symbol),
  });
  return saved;
}

async function saveToLegacyTable(input: {
  runId: string | null;
  provider: string;
  model: string;
  generatedAt: string;
  generatedTimezone: string;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource;
  items: SavedAiSymbolAnalysis[];
}) {
  const payload = input.items.map((item) => ({
    symbol: normalizeStoredSymbol(item.symbol),
    pair_name: item.pairName,
    provider: input.provider,
    model: input.model,
    bias: item.bias,
    trade_mode: item.tradeMode,
    confidence: item.confidence,
    calendar_risk: item.calendarRisk,
    decision_summary: item.decisionSummary,
    technical_summary: item.technicalSummary,
    fundamental_summary: item.fundamentalSummary,
    macro_drivers: item.macroDrivers,
    watch_events: item.watchEvents,
    risk_factors: item.riskFactors,
    generated_at: item.generatedAt,
    generated_timezone: item.generatedTimezone,
    source_data_timestamp: item.sourceDataTimestamp,
    trigger_source: item.triggerSource,
  }));

  const { data, error } = await supabase.rpc('save_ai_fundamentals_batch', {
    p_ai_analysis_run_id: input.runId,
    p_items: payload,
  });

  if (error) throw new Error(error.message);
  return (data as LegacySavedAiFundamentalRow[] | null) ?? [];
}

export async function saveAiFundamentalsBatch(input: {
  runId: string | null;
  provider: string;
  model: string;
  generatedAt: string;
  generatedTimezone: string;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource;
  items: SavedAiSymbolAnalysis[];
}) {
  if (!isDatabaseConfigured()) {
    console.warn('[ai-analysis-store] database not configured — skipping save');
    return [];
  }
  if (!input.items.length) return [];

  const symbols = input.items.map((i) => i.symbol).join(', ');
  console.info('[ai-analysis-store] saving AI fundamentals batch', { symbols, runId: input.runId, generatedAt: input.generatedAt });

  try {
    const result = await saveToModernTable(input);
    console.info('[ai-analysis-store] batch save completed via ai_fundamental_analyses', { count: result.length });
    return result;
  } catch (error) {
    logStoreWarning('modern save failed, falling back to saved_ai_fundamentals', error);
    const result = await saveToLegacyTable(input);
    console.info('[ai-analysis-store] batch save completed via saved_ai_fundamentals (legacy)', { count: result.length });
    return result;
  }
}

export async function getLatestSuccessfulAiAnalysisRun(): Promise<AiAnalysisRunRow | null> {
  if (!isDatabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('ai_analysis_runs')
    .select('*')
    .eq('status', 'success')
    .order('generated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logStoreWarning('latest success lookup failed', error);
    return null;
  }

  return (data as AiAnalysisRunRow | null) ?? null;
}

async function getLatestModernRows(): Promise<SavedAiSymbolAnalysis[]> {
  const { data, error } = await supabase
    .from('ai_fundamental_analyses')
    .select('*')
    .eq('status', 'completed')
    .eq('is_latest', true)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('generated_at', { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);
  return ((data as ModernAiFundamentalRow[] | null) ?? []).map(hydrateSavedAnalysis);
}

async function getLatestLegacyRows(): Promise<SavedAiSymbolAnalysis[]> {
  const { data, error } = await supabase
    .from('saved_ai_fundamentals')
    .select('*')
    .eq('is_latest', true)
    .order('generated_at', { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);
  return ((data as LegacySavedAiFundamentalRow[] | null) ?? []).map(hydrateSavedAnalysis);
}

export async function getLatestSavedAiAnalysis(): Promise<SavedAiAnalysisPayload | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const modernRows = await getLatestModernRows();
    if (modernRows.length > 0) return toAggregatePayload(modernRows);
  } catch (error) {
    logStoreWarning('modern latest lookup failed, falling back to saved_ai_fundamentals', error);
  }

  return toAggregatePayload(await getLatestLegacyRows());
}

async function getLatestModernSymbol(symbol: string) {
  const { data, error } = await supabase
    .from('ai_fundamental_analyses')
    .select('*')
    .eq('symbol', normalizeStoredSymbol(symbol))
    .eq('status', 'completed')
    .eq('is_latest', true)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('generated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? hydrateSavedAnalysis(data as ModernAiFundamentalRow) : null;
}

async function getLatestLegacySymbol(symbol: string) {
  const { data, error } = await supabase
    .from('saved_ai_fundamentals')
    .select('*')
    .eq('symbol', normalizeStoredSymbol(symbol))
    .eq('is_latest', true)
    .order('generated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? hydrateSavedAnalysis(data as LegacySavedAiFundamentalRow) : null;
}

export async function getLatestSavedAiAnalysisForSymbol(symbol: string): Promise<SavedAiSymbolAnalysis | null> {
  if (!isDatabaseConfigured()) return null;

  const normalized = normalizeStoredSymbol(symbol);
  console.info('[ai-analysis-store] loading latest AI fundamentals', { symbol: normalized });

  try {
    const modernRow = await getLatestModernSymbol(symbol);
    if (modernRow) {
      console.info('[ai-analysis-store] found saved analysis in ai_fundamental_analyses', { symbol: normalized, generatedAt: modernRow.generatedAt });
      return modernRow;
    }
  } catch (error) {
    logStoreWarning(`modern latest symbol lookup failed for ${normalized}, falling back to saved_ai_fundamentals`, error);
  }

  const legacyRow = await getLatestLegacySymbol(symbol);
  if (legacyRow) {
    console.info('[ai-analysis-store] found saved analysis in saved_ai_fundamentals (legacy)', { symbol: normalized, generatedAt: legacyRow.generatedAt });
  } else {
    console.info('[ai-analysis-store] no completed saved analysis found', { symbol: normalized });
  }
  return legacyRow;
}

export async function getLatestSavedAiAnalysisForDisplaySymbol(symbol: string): Promise<SavedAiSymbolAnalysis | null> {
  return getLatestSavedAiAnalysisForSymbol(normalizeDisplaySymbol(symbol));
}
