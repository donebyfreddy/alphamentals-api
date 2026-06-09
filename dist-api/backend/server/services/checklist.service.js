"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChecklist = createChecklist;
exports.getChecklists = getChecklists;
exports.getChecklistById = getChecklistById;
const gemini_js_1 = require("../lib/gemini.js");
const supabase_js_1 = require("../lib/supabase.js");
function computeReadinessScore(input) {
    const weights = {
        htfBiasAligned: 15,
        bosChochConfirmed: 15,
        liquiditySweepConfirmed: 12,
        rrMeetsMinimum: 12,
        notRevengeTrade: 10,
        notFomo: 10,
        emotionalStateOk: 8,
        newsRiskChecked: 8,
        sessionValid: 7,
        riskSizedCorrectly: 7,
        entryTimeframeAligned: 5,
        keyLevelPresent: 5,
    };
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
        if (input[key])
            score += weight;
    }
    return score;
}
async function createChecklist(userId, input) {
    const readinessScore = computeReadinessScore(input);
    let aiValidation;
    if (readinessScore < 80) {
        const failed = Object.entries(input)
            .filter(([k, v]) => typeof v === 'boolean' && !v)
            .map(([k]) => k);
        const prompt = `A trader wants to enter a ${input.symbol} trade but failed these checklist items: ${failed.join(', ')}.
Readiness score: ${readinessScore}/100.
Give a 2-sentence coaching note. Should they take this trade? Be direct.`;
        const msg = await (0, gemini_js_1.chatComplete)([{ role: 'user', content: prompt }], { maxTokens: 150, temperature: 0.2, jsonMode: false, feature: 'checklist', operation: 'validate_trade' });
        aiValidation = msg.content || undefined;
    }
    else {
        aiValidation = `Checklist passed with ${readinessScore}/100. All critical conditions met. Proceed with your plan and manage risk precisely.`;
    }
    const { data, error } = await supabase_js_1.supabase
        .from('pre_trade_checklists')
        .insert({ userId, ...input, readinessScore, aiValidation })
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return data;
}
async function getChecklists(userId, limit = 10) {
    const { data, error } = await supabase_js_1.supabase
        .from('pre_trade_checklists')
        .select('*')
        .eq('userId', userId)
        .order('createdAt', { ascending: false })
        .limit(limit);
    if (error)
        throw new Error(error.message);
    return data ?? [];
}
async function getChecklistById(userId, id) {
    const { data, error } = await supabase_js_1.supabase
        .from('pre_trade_checklists')
        .select('*')
        .eq('id', id)
        .eq('userId', userId)
        .single();
    if (error || !data)
        throw new Error('Checklist not found');
    return data;
}
