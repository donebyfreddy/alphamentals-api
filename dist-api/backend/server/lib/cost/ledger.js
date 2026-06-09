"use strict";
/**
 * API Cost Ledger — fire-and-forget persistence layer.
 *
 * Every call is non-blocking: failures are logged but never rethrow.
 * This prevents cost tracking issues from affecting core functionality.
 *
 * Safety: never log or store API keys, tokens, or secrets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordCost = recordCost;
exports.queryLedger = queryLedger;
exports.aggregateCosts = aggregateCosts;
const supabase_js_1 = require("../supabase.js");
/** Record a cost event. Non-blocking — never throws. */
function recordCost(event) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return;
    const promptTokens = event.promptTokens ?? 0;
    const completionTokens = event.completionTokens ?? 0;
    const totalTokens = event.totalTokens ?? (promptTokens + completionTokens);
    const row = {
        provider: event.provider,
        service: event.service,
        model: event.model ?? '',
        feature: event.feature ?? '',
        operation: event.operation ?? '',
        request_id: event.requestId ?? '',
        status: event.status,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        input_cost_usd: event.inputCostUsd ?? 0,
        output_cost_usd: event.outputCostUsd ?? 0,
        total_cost_usd: event.totalCostUsd ?? 0,
        currency: 'USD',
        metadata_json: event.metadata ?? {},
    };
    // Fire and forget
    supabase_js_1.supabase
        .from('api_cost_ledger')
        .insert(row)
        .then(({ error }) => {
        if (error) {
            console.warn('[cost-ledger] insert failed:', error.message);
        }
        else {
            const cost = event.totalCostUsd ?? 0;
            console.info('[cost-ledger] recorded', {
                provider: event.provider,
                feature: event.feature ?? '-',
                model: event.model ?? '-',
                cost: `$${cost.toFixed(6)}`,
                status: event.status,
            });
        }
    })
        .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[cost-ledger] unexpected error:', message);
    });
}
function rangeStart(range) {
    const now = new Date();
    if (range === 'today') {
        now.setHours(0, 0, 0, 0);
        return now.toISOString();
    }
    if (range === '7d') {
        now.setDate(now.getDate() - 7);
        return now.toISOString();
    }
    if (range === '30d') {
        now.setDate(now.getDate() - 30);
        return now.toISOString();
    }
    if (range === 'month') {
        now.setDate(1);
        now.setHours(0, 0, 0, 0);
        return now.toISOString();
    }
    // default: current month
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
}
async function queryLedger(opts = {}) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return { rows: [], total: 0 };
    const from = rangeStart(opts.range ?? 'month');
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    let q = supabase_js_1.supabase
        .from('api_cost_ledger')
        .select('*', { count: 'exact' })
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (opts.provider && opts.provider !== 'all')
        q = q.eq('provider', opts.provider);
    if (opts.feature && opts.feature !== 'all')
        q = q.eq('feature', opts.feature);
    const { data, error, count } = await q;
    if (error)
        throw new Error(`Cost ledger query failed: ${error.message}`);
    return { rows: (data ?? []), total: count ?? 0 };
}
async function aggregateCosts(provider, range = 'month') {
    if (!(0, supabase_js_1.isDatabaseConfigured)()) {
        return {
            totalRequests: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
            costUsd: 0, byModel: [], byFeature: [],
        };
    }
    const from = rangeStart(range);
    const { data, error } = await supabase_js_1.supabase
        .from('api_cost_ledger')
        .select('model, feature, prompt_tokens, completion_tokens, total_tokens, total_cost_usd')
        .eq('provider', provider)
        .gte('created_at', from);
    if (error)
        throw new Error(`Cost aggregate query failed: ${error.message}`);
    const rows = (data ?? []);
    let totalRequests = 0, totalTokens = 0, promptTokens = 0, completionTokens = 0, costUsd = 0;
    const modelMap = new Map();
    const featureMap = new Map();
    for (const row of rows) {
        totalRequests++;
        promptTokens += row.prompt_tokens;
        completionTokens += row.completion_tokens;
        totalTokens += row.total_tokens;
        costUsd += Number(row.total_cost_usd);
        const m = modelMap.get(row.model) ?? { costUsd: 0, requests: 0, tokens: 0 };
        m.costUsd += Number(row.total_cost_usd);
        m.requests += 1;
        m.tokens += row.total_tokens;
        modelMap.set(row.model, m);
        const key = row.feature || 'unknown';
        const f = featureMap.get(key) ?? { costUsd: 0, requests: 0, tokens: 0 };
        f.costUsd += Number(row.total_cost_usd);
        f.requests += 1;
        f.tokens += row.total_tokens;
        featureMap.set(key, f);
    }
    return {
        totalRequests,
        totalTokens,
        promptTokens,
        completionTokens,
        costUsd,
        byModel: Array.from(modelMap.entries()).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
        byFeature: Array.from(featureMap.entries()).map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.costUsd - a.costUsd),
    };
}
