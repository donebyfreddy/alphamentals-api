"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_ANALYSIS_SYMBOLS = void 0;
exports.getAiAnalysisSymbols = getAiAnalysisSymbols;
exports.createAiAnalysisRun = createAiAnalysisRun;
exports.updateAiAnalysisRun = updateAiAnalysisRun;
exports.saveAiFundamentalsBatch = saveAiFundamentalsBatch;
exports.getLatestSuccessfulAiAnalysisRun = getLatestSuccessfulAiAnalysisRun;
exports.getLatestSavedAiAnalysis = getLatestSavedAiAnalysis;
exports.getLatestSavedAiAnalysisForSymbol = getLatestSavedAiAnalysisForSymbol;
exports.getLatestSavedAiAnalysisForDisplaySymbol = getLatestSavedAiAnalysisForDisplaySymbol;
const supabase_js_1 = require("../lib/supabase.js");
const symbolConfig_js_1 = require("../../../src/lib/symbolConfig.js");
const symbolNormalizer_js_1 = require("../../../src/services/pairs/symbolNormalizer.js");
const EXTRA_AI_ANALYSIS_SYMBOLS = ['DXY', 'USOIL', 'NAS100', 'SPX500'];
exports.AI_ANALYSIS_SYMBOLS = [
    ...new Set([...Object.keys(symbolConfig_js_1.DEFAULT_SYMBOLS), ...EXTRA_AI_ANALYSIS_SYMBOLS]),
];
function normalizeStoredSymbol(symbol) {
    return (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
}
function uniqueNormalizedSymbols(symbols) {
    return [...new Set(symbols.map((symbol) => normalizeStoredSymbol(symbol)).filter(Boolean))];
}
function fromFlattenedRow(row) {
    const symbol = normalizeStoredSymbol(row.symbol);
    const summary = row.summary?.trim() || row.decision_summary || row.fundamental_summary || row.technical_summary || (0, symbolNormalizer_js_1.getDisplayName)(symbol);
    return {
        id: row.id,
        analysisRunId: row.ai_analysis_run_id ?? null,
        symbol,
        pairName: row.pair_name || (0, symbolNormalizer_js_1.getDisplayName)(symbol),
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
function hydrateSavedAnalysis(row) {
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
function toAggregatePayload(rows) {
    if (!rows.length)
        return null;
    const leader = rows.reduce((latest, row) => (new Date(row.generatedAt).getTime() > new Date(latest.generatedAt).getTime() ? row : latest), rows[0]);
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
function logStoreWarning(message, error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[ai-analysis-store] ${message}: ${detail}`);
}
function getAiAnalysisSymbols() {
    return [...exports.AI_ANALYSIS_SYMBOLS];
}
async function createAiAnalysisRun(input) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return null;
    const { data, error } = await supabase_js_1.supabase
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
    if (error)
        throw new Error(`Failed to create AI analysis run: ${error.message}`);
    return data;
}
async function updateAiAnalysisRun(id, input) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return null;
    const patch = input.status === 'success'
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
    const { data, error } = await supabase_js_1.supabase
        .from('ai_analysis_runs')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
    if (error)
        throw new Error(`Failed to update AI analysis run: ${error.message}`);
    return data;
}
async function saveToModernTable(input) {
    const symbols = uniqueNormalizedSymbols(input.items.map((item) => item.symbol));
    console.info('[ai-analysis-store] saving to ai_fundamental_analyses', { symbols, runId: input.runId });
    const { error: latestError } = await supabase_js_1.supabase
        .from('ai_fundamental_analyses')
        .update({ is_latest: false })
        .in('symbol', symbols)
        .eq('is_latest', true);
    if (latestError)
        throw new Error(latestError.message);
    const rows = input.items.map((item) => {
        const normalizedSymbol = normalizeStoredSymbol(item.symbol);
        const hydratedItem = {
            ...item,
            symbol: normalizedSymbol,
            pairName: item.pairName || (0, symbolNormalizer_js_1.getDisplayName)(normalizedSymbol),
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
    const { data, error } = await supabase_js_1.supabase
        .from('ai_fundamental_analyses')
        .insert(rows)
        .select('*');
    if (error)
        throw new Error(error.message);
    const saved = data ?? [];
    console.info('[ai-analysis-store] saved to ai_fundamental_analyses', {
        count: saved.length,
        ids: saved.map((r) => r.id),
        symbols: saved.map((r) => r.symbol),
    });
    return saved;
}
async function saveToLegacyTable(input) {
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
    const { data, error } = await supabase_js_1.supabase.rpc('save_ai_fundamentals_batch', {
        p_ai_analysis_run_id: input.runId,
        p_items: payload,
    });
    if (error)
        throw new Error(error.message);
    return data ?? [];
}
async function saveAiFundamentalsBatch(input) {
    if (!(0, supabase_js_1.isDatabaseConfigured)()) {
        console.warn('[ai-analysis-store] database not configured — skipping save');
        return [];
    }
    if (!input.items.length)
        return [];
    const symbols = input.items.map((i) => i.symbol).join(', ');
    console.info('[ai-analysis-store] saving AI fundamentals batch', { symbols, runId: input.runId, generatedAt: input.generatedAt });
    try {
        const result = await saveToModernTable(input);
        console.info('[ai-analysis-store] batch save completed via ai_fundamental_analyses', { count: result.length });
        return result;
    }
    catch (error) {
        logStoreWarning('modern save failed, falling back to saved_ai_fundamentals', error);
        const result = await saveToLegacyTable(input);
        console.info('[ai-analysis-store] batch save completed via saved_ai_fundamentals (legacy)', { count: result.length });
        return result;
    }
}
async function getLatestSuccessfulAiAnalysisRun() {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return null;
    const { data, error } = await supabase_js_1.supabase
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
    return data ?? null;
}
async function getLatestModernRows() {
    const { data, error } = await supabase_js_1.supabase
        .from('ai_fundamental_analyses')
        .select('*')
        .eq('status', 'completed')
        .eq('is_latest', true)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('generated_at', { ascending: false, nullsFirst: false });
    if (error)
        throw new Error(error.message);
    return (data ?? []).map(hydrateSavedAnalysis);
}
async function getLatestLegacyRows() {
    const { data, error } = await supabase_js_1.supabase
        .from('saved_ai_fundamentals')
        .select('*')
        .eq('is_latest', true)
        .order('generated_at', { ascending: false, nullsFirst: false });
    if (error)
        throw new Error(error.message);
    return (data ?? []).map(hydrateSavedAnalysis);
}
async function getLatestSavedAiAnalysis() {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return null;
    try {
        const modernRows = await getLatestModernRows();
        if (modernRows.length > 0)
            return toAggregatePayload(modernRows);
    }
    catch (error) {
        logStoreWarning('modern latest lookup failed, falling back to saved_ai_fundamentals', error);
    }
    return toAggregatePayload(await getLatestLegacyRows());
}
async function getLatestModernSymbol(symbol) {
    const { data, error } = await supabase_js_1.supabase
        .from('ai_fundamental_analyses')
        .select('*')
        .eq('symbol', normalizeStoredSymbol(symbol))
        .eq('status', 'completed')
        .eq('is_latest', true)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('generated_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? hydrateSavedAnalysis(data) : null;
}
async function getLatestLegacySymbol(symbol) {
    const { data, error } = await supabase_js_1.supabase
        .from('saved_ai_fundamentals')
        .select('*')
        .eq('symbol', normalizeStoredSymbol(symbol))
        .eq('is_latest', true)
        .order('generated_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? hydrateSavedAnalysis(data) : null;
}
async function getLatestSavedAiAnalysisForSymbol(symbol) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return null;
    const normalized = normalizeStoredSymbol(symbol);
    console.info('[ai-analysis-store] loading latest AI fundamentals', { symbol: normalized });
    try {
        const modernRow = await getLatestModernSymbol(symbol);
        if (modernRow) {
            console.info('[ai-analysis-store] found saved analysis in ai_fundamental_analyses', { symbol: normalized, generatedAt: modernRow.generatedAt });
            return modernRow;
        }
    }
    catch (error) {
        logStoreWarning(`modern latest symbol lookup failed for ${normalized}, falling back to saved_ai_fundamentals`, error);
    }
    const legacyRow = await getLatestLegacySymbol(symbol);
    if (legacyRow) {
        console.info('[ai-analysis-store] found saved analysis in saved_ai_fundamentals (legacy)', { symbol: normalized, generatedAt: legacyRow.generatedAt });
    }
    else {
        console.info('[ai-analysis-store] no completed saved analysis found', { symbol: normalized });
    }
    return legacyRow;
}
async function getLatestSavedAiAnalysisForDisplaySymbol(symbol) {
    return getLatestSavedAiAnalysisForSymbol((0, symbolNormalizer_js_1.normalizeDisplaySymbol)(symbol));
}
