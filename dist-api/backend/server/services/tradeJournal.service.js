"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTrade = createTrade;
exports.closeTrade = closeTrade;
exports.getTrades = getTrades;
exports.getTradeById = getTradeById;
exports.updateTradeReview = updateTradeReview;
exports.deleteTrade = deleteTrade;
exports.getPerformanceStats = getPerformanceStats;
const supabase_js_1 = require("../lib/supabase.js");
const tradeScoring_service_js_1 = require("./tradeScoring.service.js");
const playbook_service_js_1 = require("./playbook.service.js");
const notification_service_js_1 = require("./notification.service.js");
// Fields the user must fill before a review is considered COMPLETE.
// For losing trades (pnl < 0) the trader must also document either a mistake tag
// or a loss classification — both paths provide learning value.
// Winning and breakeven trades (pnl >= 0) are complete without that requirement.
function isReviewComplete(t) {
    const baseComplete = Boolean(t.setupId &&
        t.setupQualityGrade &&
        t.reasonForEntry &&
        t.reasonForExit &&
        t.preTradeEmotion &&
        t.followedPlan != null);
    if (!baseComplete)
        return false;
    const pnl = t.pnl ?? 0;
    if (pnl < 0) {
        const hasMistakeOrLoss = (t.mistakeTags?.length ?? 0) > 0 || !!t.lossClassification;
        return hasMistakeOrLoss;
    }
    return true;
}
async function getNextTradeNumber(userId) {
    const { data } = await supabase_js_1.supabase
        .from('trades').select('tradeNumber').eq('userId', userId)
        .order('tradeNumber', { ascending: false }).limit(1).maybeSingle();
    return (data?.tradeNumber ?? 0) + 1;
}
async function createTrade(userId, input) {
    const rrPlanned = Math.abs(input.takeProfit - input.entryPrice) / Math.abs(input.entryPrice - input.stopLoss);
    const tradeNumber = await getNextTradeNumber(userId);
    const { data, error } = await supabase_js_1.supabase.from('trades').insert({
        userId, tradeNumber,
        symbol: input.symbol.toUpperCase(), direction: input.direction,
        entryPrice: input.entryPrice, stopLoss: input.stopLoss, takeProfit: input.takeProfit,
        positionSize: input.positionSize, riskPercent: input.riskPercent,
        rrPlanned: Math.round(rrPlanned * 100) / 100, session: input.session,
        timeframe: input.timeframe, setupType: input.setupType,
        confluences: input.confluences ?? [], tags: input.tags ?? [],
        preTradeEmotion: input.preTradeEmotion ?? 'NEUTRAL',
        confidenceLevel: input.confidenceLevel ?? 5,
        tradePlan: input.tradePlan, reasonForEntry: input.reasonForEntry,
        entryTime: new Date(input.entryTime).toISOString(),
        checklistId: input.checklistId,
        isRevengeTrade: input.isRevengeTrade ?? false, isFomo: input.isFomo ?? false,
        status: 'OPEN',
    }).select().single();
    if (error)
        throw new Error(error.message);
    return data;
}
async function closeTrade(userId, tradeId, input) {
    const { data: trade, error: fetchErr } = await supabase_js_1.supabase
        .from('trades').select('*').eq('id', tradeId).eq('userId', userId).single();
    if (fetchErr || !trade)
        throw new Error('Trade not found');
    const pnlPips = trade.direction === 'LONG'
        ? input.closePrice - trade.entryPrice
        : trade.entryPrice - input.closePrice;
    const pnlPercent = (pnlPips / trade.entryPrice) * 100;
    const pnl = pnlPips * trade.positionSize;
    const rrActual = pnlPips > 0
        ? pnlPips / Math.abs(trade.entryPrice - trade.stopLoss)
        : -(Math.abs(pnlPips) / Math.abs(trade.entryPrice - trade.stopLoss));
    const { data, error } = await supabase_js_1.supabase.from('trades').update({
        closePrice: input.closePrice, exitTime: new Date(input.exitTime).toISOString(),
        status: 'CLOSED', pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        pnlPips: Math.round(pnlPips * 10000) / 100,
        rrActual: Math.round(rrActual * 100) / 100,
        postTradeEmotion: input.postTradeEmotion, reasonForExit: input.reasonForExit,
        lessonsLearned: input.lessonsLearned, mistakeTags: input.mistakeTags ?? [],
        followedPlan: input.followedPlan, screenshotUrls: input.screenshotUrls ?? [],
    }).eq('id', tradeId).select().single();
    if (error)
        throw new Error(error.message);
    // Notify through the central hub (never blocks/throws).
    const closedPnl = Math.round(pnl * 100) / 100;
    void (0, notification_service_js_1.createNotification)({
        userId,
        title: `Trade closed: ${trade.symbol} ${trade.direction}`,
        message: `${trade.symbol} closed at ${input.closePrice} for ${closedPnl >= 0 ? '+' : ''}${closedPnl} (${Math.round(rrActual * 100) / 100}R).`,
        category: 'journal_trade',
        severity: closedPnl < 0 ? 'warning' : 'info',
        source: 'journal',
        symbol: trade.symbol,
        link: `/journal/trades/${tradeId}`,
        metadata: { pnl: closedPnl, rrActual: Math.round(rrActual * 100) / 100 },
        dedupeKey: `trade-close-${tradeId}`,
    });
    return data;
}
async function getTrades(userId, filter = {}) {
    const { page = 1, limit = 20, from, to, ...rest } = filter;
    const skip = (page - 1) * limit;
    let query = supabase_js_1.supabase.from('trades').select('*', { count: 'exact' }).eq('userId', userId);
    if (rest.symbol)
        query = query.eq('symbol', rest.symbol);
    if (rest.direction)
        query = query.eq('direction', rest.direction);
    if (rest.status)
        query = query.eq('status', rest.status);
    if (rest.session)
        query = query.eq('session', rest.session);
    if (rest.setupType)
        query = query.eq('setupType', rest.setupType);
    if (rest.reviewStatus)
        query = query.eq('reviewStatus', rest.reviewStatus);
    if (rest.setupId)
        query = query.eq('setupId', rest.setupId);
    if (rest.setupQualityGrade)
        query = query.eq('setupQualityGrade', rest.setupQualityGrade);
    if (from)
        query = query.gte('entryTime', new Date(from).toISOString());
    if (to)
        query = query.lte('entryTime', new Date(to).toISOString());
    query = query.order('entryTime', { ascending: false }).range(skip, skip + limit - 1);
    const { data: trades, count, error } = await query;
    if (error)
        throw new Error(error.message);
    const total = count ?? 0;
    return { trades: trades ?? [], total, page, limit, pages: Math.ceil(total / limit) };
}
async function getTradeById(userId, tradeId) {
    const { data, error } = await supabase_js_1.supabase.from('trades').select('*').eq('id', tradeId).eq('userId', userId).single();
    if (error || !data)
        throw new Error('Trade not found');
    return data;
}
/**
 * Save a post-trade review and recompute all process scores deterministically.
 * The 6 scores + overall are derived from the merged review data via the scoring
 * engine — never hard-coded. Returns the updated trade.
 */
async function updateTradeReview(userId, tradeId, input) {
    const { data: trade, error: fetchErr } = await supabase_js_1.supabase
        .from('trades').select('*').eq('id', tradeId).eq('userId', userId).single();
    if (fetchErr || !trade)
        throw new Error('Trade not found');
    const { data: profile } = await supabase_js_1.supabase
        .from('user_profiles').select('riskPerTradePercent').eq('userId', userId).maybeSingle();
    // Merge incoming review fields over the existing row (only defined keys).
    const merged = { ...trade };
    for (const [k, v] of Object.entries(input)) {
        if (v !== undefined)
            merged[k] = v;
    }
    const scores = (0, tradeScoring_service_js_1.computeScores)({
        stopLoss: merged.stopLoss,
        takeProfit: merged.takeProfit,
        entryPrice: merged.entryPrice,
        riskPercent: merged.riskPercent,
        rrPlanned: merged.rrPlanned,
        pnl: merged.pnl,
        session: merged.session,
        setupQualityGrade: merged.setupQualityGrade,
        blueprintRulesFollowed: merged.blueprintRulesFollowed,
        blueprintRulesBroken: merged.blueprintRulesBroken,
        preTradeEmotion: merged.preTradeEmotion,
        duringTradeEmotion: merged.duringTradeEmotion,
        postTradeEmotion: merged.postTradeEmotion,
        isRevengeTrade: merged.isRevengeTrade,
        isFomo: merged.isFomo,
        hesitation: merged.hesitation,
        movedStopLoss: merged.movedStopLoss,
        closedEarly: merged.closedEarly,
        followedPlan: merged.followedPlan,
        mistakeTags: merged.mistakeTags,
        maxRiskPercent: profile?.riskPerTradePercent ?? null,
    });
    const complete = isReviewComplete(merged);
    const reviewStatus = complete ? 'COMPLETE' : 'IN_PROGRESS';
    const updatePayload = {
        // review fields (only defined ones)
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        // engine scores (source of truth)
        setupQuality: scores.setupQuality,
        executionScore: scores.executionScore,
        psychologyScore: scores.psychologyScore,
        disciplineScore: scores.disciplineScore,
        riskScore: scores.riskScore,
        patienceScore: scores.patienceScore,
        overallScore: scores.overallScore,
        aiScore: scores.overallScore,
        blueprintMatchScore: scores.blueprintMatchScore,
        reviewStatus,
        reviewCompletedAt: complete ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
    };
    const { data, error } = await supabase_js_1.supabase
        .from('trades').update(updatePayload).eq('id', tradeId).eq('userId', userId).select().single();
    if (error)
        throw new Error(error.message);
    // Keep the parent setup's rollup stats fresh.
    if (merged.setupId) {
        try {
            await (0, playbook_service_js_1.recomputeSetupStats)(userId, merged.setupId);
        }
        catch { /* non-fatal */ }
    }
    return { trade: data, scores };
}
async function deleteTrade(userId, tradeId) {
    const { data: trade } = await supabase_js_1.supabase.from('trades').select('id').eq('id', tradeId).eq('userId', userId).single();
    if (!trade)
        throw new Error('Trade not found');
    const { error } = await supabase_js_1.supabase.from('trades').delete().eq('id', tradeId);
    if (error)
        throw new Error(error.message);
}
function calcMaxDrawdown(trades) {
    let peak = 0, equity = 0, maxDD = 0;
    for (const x of trades) {
        equity += x.pnl ?? 0;
        if (equity > peak)
            peak = equity;
        const dd = peak - equity;
        if (dd > maxDD)
            maxDD = dd;
    }
    return maxDD;
}
function calcConsecutiveStreaks(trades) {
    let cW = 0, mW = 0, cL = 0, mL = 0;
    for (const x of trades) {
        const p = x.pnl ?? 0;
        if (p > 0) {
            cW++;
            cL = 0;
            mW = Math.max(mW, cW);
        }
        else if (p < 0) {
            cL++;
            cW = 0;
            mL = Math.max(mL, cL);
        }
    }
    return { maxConsecWins: mW, maxConsecLosses: mL };
}
function calcAvgHoldTime(trades) {
    const holdTimes = trades
        .filter((x) => x.exitTime)
        .map((x) => (new Date(x.exitTime).getTime() - new Date(x.entryTime).getTime()) / 60000);
    return holdTimes.length ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
}
function calcProfitFactor(grossWin, grossLoss) {
    if (grossLoss > 0)
        return grossWin / grossLoss;
    if (grossWin > 0)
        return Infinity;
    return 0;
}
async function getPerformanceStats(userId, from, to) {
    let query = supabase_js_1.supabase.from('trades').select('*').eq('userId', userId).eq('status', 'CLOSED').order('entryTime', { ascending: true });
    if (from)
        query = query.gte('entryTime', new Date(from).toISOString());
    if (to)
        query = query.lte('entryTime', new Date(to).toISOString());
    const { data: trades } = await query;
    const t = trades ?? [];
    if (!t.length) {
        return { totalTrades: 0, winCount: 0, lossCount: 0, breakEvenCount: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0, avgRR: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0, maxConsecWins: 0, maxConsecLosses: 0, bestTrade: 0, worstTrade: 0, avgHoldTime: 0 };
    }
    const wins = t.filter((x) => (x.pnl ?? 0) > 0);
    const losses = t.filter((x) => (x.pnl ?? 0) < 0);
    const pnlValues = t.map((x) => x.pnl ?? 0);
    const totalPnl = pnlValues.reduce((s, v) => s + v, 0);
    const totalPnlPercent = t.reduce((s, x) => s + (x.pnlPercent ?? 0), 0);
    const avgRR = t.reduce((s, x) => s + (x.rrActual ?? 0), 0) / t.length;
    const grossWin = wins.reduce((s, x) => s + (x.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, x) => s + (x.pnl ?? 0), 0));
    const avgWin = wins.length ? grossWin / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = calcProfitFactor(grossWin, grossLoss);
    const winRate = wins.length / t.length;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
    const maxDD = calcMaxDrawdown(t);
    const { maxConsecWins, maxConsecLosses } = calcConsecutiveStreaks(t);
    const avgHoldTime = calcAvgHoldTime(t);
    return {
        totalTrades: t.length,
        winCount: wins.length,
        lossCount: losses.length,
        breakEvenCount: t.filter((x) => (x.pnl ?? 0) === 0).length,
        winRate: Math.round(winRate * 1000) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
        avgRR: Math.round(avgRR * 100) / 100,
        avgWin: Math.round(avgWin * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        expectancy: Math.round(expectancy * 100) / 100,
        maxDrawdown: Math.round(maxDD * 100) / 100,
        maxConsecWins,
        maxConsecLosses,
        bestTrade: Math.max(...pnlValues),
        worstTrade: Math.min(...pnlValues),
        avgHoldTime: Math.round(avgHoldTime),
    };
}
