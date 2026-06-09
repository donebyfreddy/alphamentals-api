"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEquityCurve = getEquityCurve;
exports.getSessionHeatmap = getSessionHeatmap;
exports.getDayOfWeekHeatmap = getDayOfWeekHeatmap;
exports.getMistakeBreakdown = getMistakeBreakdown;
exports.getSetupPerformance = getSetupPerformance;
exports.getPsychologyCorrelations = getPsychologyCorrelations;
exports.detectMistakePatterns = detectMistakePatterns;
exports.getSetupQualityPerformance = getSetupQualityPerformance;
exports.getMistakeCost = getMistakeCost;
exports.getDisciplineStats = getDisciplineStats;
exports.getRiskFlagStats = getRiskFlagStats;
exports.getTimeOfDayPerformance = getTimeOfDayPerformance;
exports.getPsychologyByPhase = getPsychologyByPhase;
exports.getPerformanceBySymbol = getPerformanceBySymbol;
exports.getGoodVsBadLossStats = getGoodVsBadLossStats;
exports.getPsychologyFlagCost = getPsychologyFlagCost;
exports.getReviewCoverage = getReviewCoverage;
const supabase_js_1 = require("../lib/supabase.js");
const GRADE_LABELS = {
    A_PLUS: 'A+ Setup', A: 'A Setup', B: 'B Setup', C: 'C Setup', FORCED: 'Forced Trade', NO_SETUP: 'No Valid Setup',
};
function avg(nums) {
    return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length)) : 0;
}
function winRatePct(wins, total) {
    return total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
}
// ─── Equity curve — all CLOSED trades (no review filter) ─────────────────────
async function getEquityCurve(userId, from, to) {
    let query = supabase_js_1.supabase.from('trades').select('entryTime, pnl').eq('userId', userId).eq('status', 'CLOSED').order('entryTime', { ascending: true });
    if (from)
        query = query.gte('entryTime', new Date(from).toISOString());
    if (to)
        query = query.lte('entryTime', new Date(to).toISOString());
    const { data: trades } = await query;
    let equity = 0, peak = 0;
    const points = [];
    const byDate = new Map();
    for (const t of trades ?? []) {
        const date = new Date(t.entryTime).toISOString().slice(0, 10);
        const existing = byDate.get(date) ?? { pnl: 0, count: 0 };
        byDate.set(date, { pnl: existing.pnl + (t.pnl ?? 0), count: existing.count + 1 });
    }
    for (const [date, { pnl, count }] of byDate) {
        equity += pnl;
        if (equity > peak)
            peak = equity;
        const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        points.push({ date, equity: Math.round(equity * 100) / 100, drawdown: Math.round(drawdown * 100) / 100, tradeCount: count });
    }
    return points;
}
// ─── Session heatmap — reviewed only ─────────────────────────────────────────
async function getSessionHeatmap(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('session, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const s = t.session;
        const e = map.get(s) ?? { pnl: 0, wins: 0, total: 0 };
        map.set(s, { pnl: e.pnl + (t.pnl ?? 0), wins: e.wins + ((t.pnl ?? 0) > 0 ? 1 : 0), total: e.total + 1 });
    }
    return Array.from(map.entries()).map(([label, { pnl, wins, total }]) => ({
        label,
        value: Math.round(pnl * 100) / 100,
        count: total,
        winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
    }));
}
// ─── Day-of-week heatmap — reviewed only ─────────────────────────────────────
async function getDayOfWeekHeatmap(userId) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('entryTime, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const d = new Date(t.entryTime).getDay();
        const e = map.get(d) ?? { pnl: 0, wins: 0, total: 0 };
        map.set(d, { pnl: e.pnl + (t.pnl ?? 0), wins: e.wins + ((t.pnl ?? 0) > 0 ? 1 : 0), total: e.total + 1 });
    }
    return days.map((label, i) => {
        const e = map.get(i) ?? { pnl: 0, wins: 0, total: 0 };
        return { label, value: Math.round(e.pnl * 100) / 100, count: e.total, winRate: e.total > 0 ? Math.round((e.wins / e.total) * 1000) / 10 : 0 };
    });
}
// ─── Mistake breakdown — reviewed only ───────────────────────────────────────
async function getMistakeBreakdown(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('mistakeTags, pnl, executionScore')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE')
        .not('mistakeTags', 'eq', '{}');
    const map = new Map();
    for (const t of trades ?? []) {
        for (const tag of t.mistakeTags ?? []) {
            const e = map.get(tag) ?? { count: 0, pnl: 0, scores: [] };
            e.count++;
            e.pnl += t.pnl ?? 0;
            if (t.executionScore != null)
                e.scores.push(t.executionScore);
            map.set(tag, e);
        }
    }
    return Array.from(map.entries())
        .map(([tag, { count, pnl, scores }]) => ({
        tag,
        count,
        pnlImpact: Math.round(pnl * 100) / 100,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    }))
        .sort((a, b) => b.count - a.count);
}
// ─── Setup performance — reviewed only ───────────────────────────────────────
async function getSetupPerformance(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('setupType, pnl, rrActual')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const s = t.setupType;
        const e = map.get(s) ?? { wins: 0, total: 0, pnl: 0, rr: [] };
        e.total++;
        e.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0)
            e.wins++;
        if (t.rrActual != null)
            e.rr.push(t.rrActual);
        map.set(s, e);
    }
    return Array.from(map.entries()).map(([setup, { wins, total, pnl, rr }]) => {
        const winRate = wins / total;
        const avgRR = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
        const grossWin = rr.filter(r => r > 0).reduce((a, b) => a + b, 0);
        const grossLoss = Math.abs(rr.filter(r => r < 0).reduce((a, b) => a + b, 0));
        return {
            setup,
            trades: total,
            winRate: Math.round(winRate * 1000) / 10,
            avgRR: Math.round(avgRR * 100) / 100,
            expectancy: Math.round((winRate * avgRR - (1 - winRate)) * 100) / 100,
            profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : 0,
        };
    }).sort((a, b) => b.trades - a.trades);
}
// ─── Psychology correlations — reviewed only ─────────────────────────────────
async function getPsychologyCorrelations(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('preTradeEmotion, pnl, psychologyScore')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const e = t.preTradeEmotion;
        const entry = map.get(e) ?? { wins: 0, total: 0, pnl: 0, scores: [] };
        entry.total++;
        entry.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0)
            entry.wins++;
        if (t.psychologyScore != null)
            entry.scores.push(t.psychologyScore);
        map.set(e, entry);
    }
    return Array.from(map.entries()).map(([emotion, { wins, total, pnl, scores }]) => ({
        emotion,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
        count: total,
        avgPnl: total > 0 ? Math.round((pnl / total) * 100) / 100 : 0,
    })).sort((a, b) => b.count - a.count);
}
// ─── Mistake pattern detection — reviewed only ───────────────────────────────
async function detectMistakePatterns(userId) {
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);
    const { data: trades } = await supabase_js_1.supabase
        .from('trades')
        .select('pnl, isRevengeTrade, isFomo, mistakeTags, rrActual, rrPlanned, entryTime')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE')
        .gte('entryTime', last30.toISOString())
        .order('entryTime', { ascending: true });
    const t = trades ?? [];
    const warnings = [];
    const revengeCount = t.filter(x => x.isRevengeTrade).length;
    if (revengeCount >= 2)
        warnings.push(`Revenge trading detected: ${revengeCount} trades in 30 days`);
    const byDay = new Map();
    for (const x of t) {
        const d = new Date(x.entryTime).toISOString().slice(0, 10);
        byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const overtradedDays = Array.from(byDay.values()).filter(c => c > 3).length;
    if (overtradedDays >= 2)
        warnings.push(`Overtrading pattern: ${overtradedDays} days with 3+ trades`);
    const rrViolations = t.filter(x => x.rrActual != null && x.rrPlanned > 0 && (x.rrActual / x.rrPlanned) < 0.5).length;
    if (rrViolations >= 3)
        warnings.push(`RR violation: cutting winners early ${rrViolations} times`);
    const fomoCount = t.filter(x => x.isFomo).length;
    if (fomoCount >= 2)
        warnings.push(`FOMO trading: ${fomoCount} FOMO entries detected`);
    let streak = 0;
    for (const x of t) {
        if ((x.pnl ?? 0) < 0) {
            streak++;
        }
        else {
            streak = 0;
        }
    }
    if (streak >= 3)
        warnings.push(`Active loss streak: ${streak} consecutive losses — consider a break`);
    return warnings;
}
// ─── Journal v2 analytics ────────────────────────────────────────────────────
async function getSetupQualityPerformance(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('setupQualityGrade, pnl, rrActual, disciplineScore, psychologyScore')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE')
        .not('setupQualityGrade', 'is', null);
    const map = new Map();
    for (const t of trades ?? []) {
        const g = t.setupQualityGrade;
        const e = map.get(g) ?? { wins: 0, total: 0, pnl: 0, rr: [], disc: [], psy: [] };
        e.total++;
        e.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0)
            e.wins++;
        if (t.rrActual != null)
            e.rr.push(t.rrActual);
        if (t.disciplineScore != null)
            e.disc.push(t.disciplineScore);
        if (t.psychologyScore != null)
            e.psy.push(t.psychologyScore);
        map.set(g, e);
    }
    const order = ['A_PLUS', 'A', 'B', 'C', 'FORCED', 'NO_SETUP'];
    return Array.from(map.entries())
        .map(([grade, e]) => ({
        grade: GRADE_LABELS[grade] ?? grade,
        trades: e.total,
        winRate: winRatePct(e.wins, e.total),
        pnl: Math.round(e.pnl * 100) / 100,
        avgRR: e.rr.length ? Math.round((e.rr.reduce((a, b) => a + b, 0) / e.rr.length) * 100) / 100 : 0,
        avgDiscipline: avg(e.disc),
        avgPsychology: avg(e.psy),
        _sort: order.indexOf(grade),
    }))
        .sort((a, b) => a._sort - b._sort)
        .map(({ _sort, ...rest }) => rest);
}
async function getMistakeCost(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('mistakeTags, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        for (const tag of t.mistakeTags ?? []) {
            const e = map.get(tag) ?? { count: 0, pnl: 0, wins: 0 };
            e.count++;
            e.pnl += t.pnl ?? 0;
            if ((t.pnl ?? 0) > 0)
                e.wins++;
            map.set(tag, e);
        }
    }
    return Array.from(map.entries())
        .map(([tag, e]) => ({
        tag,
        count: e.count,
        totalCost: Math.round(e.pnl * 100) / 100,
        winRate: winRatePct(e.wins, e.count),
        avgPnl: e.count > 0 ? Math.round((e.pnl / e.count) * 100) / 100 : 0,
    }))
        .sort((a, b) => a.totalCost - b.totalCost);
}
async function getDisciplineStats(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('followedPlan, blueprintMatchScore, blueprintRulesBroken, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const t = trades ?? [];
    const bucket = (rows) => {
        const total = rows.length;
        const wins = rows.filter((x) => (x.pnl ?? 0) > 0).length;
        const pnl = rows.reduce((s, x) => s + (x.pnl ?? 0), 0);
        return { trades: total, winRate: winRatePct(wins, total), pnl: Math.round(pnl * 100) / 100 };
    };
    const brokenCount = new Map();
    for (const x of t) {
        for (const r of x.blueprintRulesBroken ?? [])
            brokenCount.set(r, (brokenCount.get(r) ?? 0) + 1);
    }
    let mostBrokenRule = null;
    let maxBroken = 0;
    for (const [rule, c] of brokenCount) {
        if (c > maxBroken) {
            maxBroken = c;
            mostBrokenRule = rule;
        }
    }
    return {
        followedPlan: bucket(t.filter((x) => x.followedPlan === true)),
        brokePlan: bucket(t.filter((x) => x.followedPlan === false)),
        highBlueprint: bucket(t.filter((x) => (x.blueprintMatchScore ?? 0) >= 80)),
        lowBlueprint: bucket(t.filter((x) => x.blueprintMatchScore != null && x.blueprintMatchScore < 60)),
        mostBrokenRule,
    };
}
async function getRiskFlagStats(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('stopLoss, entryPrice, takeProfit, rrPlanned, movedStopLoss, mistakeTags, riskPercent, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const t = trades ?? [];
    const tally = (predicate) => {
        const rows = t.filter(predicate);
        return { count: rows.length, pnl: Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100 };
    };
    const slMissing = (x) => x.stopLoss == null || x.stopLoss === 0 || x.stopLoss === x.entryPrice;
    const hasTag = (x, ...names) => (x.mistakeTags ?? []).some((m) => names.includes(m));
    const missingStopLoss = tally(slMissing);
    const poorRR = tally((x) => x.rrPlanned != null && x.rrPlanned < 1);
    const movedStop = tally((x) => x.movedStopLoss === true || hasTag(x, 'MOVED_STOP', 'WIDENED_STOP'));
    const overLeveraged = tally((x) => hasTag(x, 'OVER_LEVERAGED', 'RISK_TOO_HIGH'));
    const riskAbovePlan = tally((x) => hasTag(x, 'BROKE_MAX_RISK'));
    const lostRows = t.filter((x) => (x.pnl ?? 0) < 0 && (slMissing(x) || hasTag(x, 'MOVED_STOP', 'WIDENED_STOP', 'OVER_LEVERAGED', 'BAD_RR', 'RISK_TOO_HIGH')));
    const totalLostToRiskIssues = Math.round(lostRows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
    return { missingStopLoss, poorRR, movedStop, overLeveraged, riskAbovePlan, totalLostToRiskIssues };
}
async function getTimeOfDayPerformance(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('entryTime, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const hour = new Date(t.entryTime).getUTCHours();
        const e = map.get(hour) ?? { pnl: 0, wins: 0, total: 0 };
        e.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0)
            e.wins++;
        e.total++;
        map.set(hour, e);
    }
    const cells = [];
    for (let hour = 0; hour < 24; hour++) {
        const e = map.get(hour);
        if (!e)
            continue;
        const hh = `${hour}`.padStart(2, '0');
        cells.push({
            hour,
            label: `${hh}:00 UTC`,
            value: Math.round(e.pnl * 100) / 100,
            count: e.total,
            winRate: winRatePct(e.wins, e.total),
        });
    }
    return cells;
}
/** Win-rate / P&L per emotion for a chosen phase (pre / during / post). */
async function getPsychologyByPhase(userId, phase) {
    const columnByPhase = {
        during: 'duringTradeEmotion', post: 'postTradeEmotion', pre: 'preTradeEmotion',
    };
    const column = columnByPhase[phase];
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select(`${column}, pnl, psychologyScore`)
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const emotion = t[column];
        if (!emotion)
            continue;
        const e = map.get(emotion) ?? { wins: 0, total: 0, pnl: 0, scores: [] };
        e.total++;
        e.pnl += (t.pnl ?? 0);
        if ((t.pnl ?? 0) > 0)
            e.wins++;
        if (t.psychologyScore != null)
            e.scores.push(t.psychologyScore);
        map.set(emotion, e);
    }
    return Array.from(map.entries()).map(([emotion, e]) => ({
        emotion,
        avgScore: avg(e.scores),
        winRate: winRatePct(e.wins, e.total),
        count: e.total,
        avgPnl: e.total > 0 ? Math.round((e.pnl / e.total) * 100) / 100 : 0,
        phase,
    })).sort((a, b) => b.count - a.count);
}
async function getPerformanceBySymbol(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('symbol, pnl, rrActual')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const map = new Map();
    for (const t of trades ?? []) {
        const sym = t.symbol;
        const e = map.get(sym) ?? { wins: 0, total: 0, pnl: 0, rr: [] };
        e.total++;
        e.pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0)
            e.wins++;
        if (t.rrActual != null)
            e.rr.push(t.rrActual);
        map.set(sym, e);
    }
    return Array.from(map.entries()).map(([symbol, e]) => {
        const avgRR = e.rr.length ? e.rr.reduce((a, b) => a + b, 0) / e.rr.length : 0;
        const grossWin = e.rr.filter(r => r > 0).reduce((a, b) => a + b, 0);
        const grossLoss = Math.abs(e.rr.filter(r => r < 0).reduce((a, b) => a + b, 0));
        return {
            symbol,
            tradeCount: e.total,
            winRate: winRatePct(e.wins, e.total),
            totalPnl: Math.round(e.pnl * 100) / 100,
            avgRR: Math.round(avgRR * 100) / 100,
            profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : 0,
        };
    }).sort((a, b) => b.tradeCount - a.tradeCount);
}
async function getGoodVsBadLossStats(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('lossClassification, followedPlan, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const t = trades ?? [];
    const buildBucket = (rows) => {
        const count = rows.length;
        const totalPnl = Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
        const avgPnl = count > 0 ? Math.round((totalPnl / count) * 100) / 100 : 0;
        return { count, totalPnl, avgPnl };
    };
    const validRows = t.filter(x => x.lossClassification === 'VALID');
    const badRows = t.filter(x => x.lossClassification === 'BAD' || x.lossClassification === 'AVOIDABLE');
    const undisciplinedWins = t.filter(x => x.followedPlan === false && (x.pnl ?? 0) > 0).length;
    return {
        validLosses: buildBucket(validRows),
        badLosses: buildBucket(badRows),
        undisciplinedWins,
    };
}
async function getPsychologyFlagCost(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('isFomo, isRevengeTrade, movedStopLoss, closedEarly, hesitation, pnl')
        .eq('userId', userId).eq('status', 'CLOSED').eq('reviewStatus', 'COMPLETE');
    const t = trades ?? [];
    const flags = [
        { key: 'isFomo', label: 'FOMO' },
        { key: 'isRevengeTrade', label: 'Revenge Trade' },
        { key: 'movedStopLoss', label: 'Moved Stop Loss' },
        { key: 'closedEarly', label: 'Closed Early' },
        { key: 'hesitation', label: 'Hesitation' },
    ];
    return flags.map(({ key, label }) => {
        const rows = t.filter(x => x[key] === true);
        const count = rows.length;
        const totalPnl = Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
        const avgPnl = count > 0 ? Math.round((totalPnl / count) * 100) / 100 : 0;
        const wins = rows.filter(x => (x.pnl ?? 0) > 0).length;
        return {
            flag: label,
            tradeCount: count,
            totalPnl,
            avgPnl,
            winRate: winRatePct(wins, count),
        };
    }).filter(x => x.tradeCount > 0);
}
async function getReviewCoverage(userId) {
    const { data: trades } = await supabase_js_1.supabase
        .from('trades').select('reviewStatus')
        .eq('userId', userId).eq('status', 'CLOSED');
    const t = trades ?? [];
    const total = t.length;
    const reviewed = t.filter(x => x.reviewStatus === 'COMPLETE').length;
    const inProgress = t.filter(x => x.reviewStatus === 'IN_PROGRESS').length;
    const needsReview = t.filter(x => x.reviewStatus == null || x.reviewStatus === 'PENDING').length;
    const coveragePct = total > 0 ? Math.round((reviewed / total) * 1000) / 10 : 0;
    return { total, reviewed, needsReview, inProgress, coveragePct };
}
