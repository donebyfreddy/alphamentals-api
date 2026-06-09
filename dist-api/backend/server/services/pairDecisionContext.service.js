"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPairDecisionContext = getPairDecisionContext;
const pairAnalysis_service_js_1 = require("./pairAnalysis.service.js");
const sessionTimes_js_1 = require("../../../src/utils/sessions/sessionTimes.js");
function deriveCalendarRisk(analysis) {
    if (analysis.intelligence.tradeStatus === 'high_risk')
        return 'high';
    const next = analysis.nextHighImpactEvent;
    if (next && next.isFuture) {
        if (next.minutesUntil <= 60)
            return 'high';
        if (next.minutesUntil <= 180)
            return 'medium';
    }
    return 'low';
}
function deriveSpreadInfo(bid, ask, price) {
    if (bid == null || ask == null || price == null || price === 0) {
        return { spreadStatus: 'unavailable', currentSpread: null };
    }
    const spread = ask - bid;
    const spreadPct = (spread / price) * 100;
    return {
        spreadStatus: spreadPct > 0.05 ? 'wide' : 'normal',
        currentSpread: Number(spread.toFixed(5)),
    };
}
async function getPairDecisionContext(symbol) {
    const analysis = await (0, pairAnalysis_service_js_1.buildPairAnalysis)(symbol, { preferSavedAi: true });
    const calendarRisk = deriveCalendarRisk(analysis);
    const { spreadStatus, currentSpread } = deriveSpreadInfo(analysis.price.bid, analysis.price.ask, analysis.price.current);
    const highImpactEvents = analysis.relevantEvents
        .filter((e) => e.impact === 'high' && e.isFuture)
        .slice(0, 5)
        .map((e) => {
        const currency = e.currency ? ` (${e.currency})` : '';
        return `${e.eventName}${currency} in ${e.minutesUntil}m`;
    });
    let volatility = null;
    if (analysis.price.dayHigh != null && analysis.price.dayLow != null) {
        volatility = Number((analysis.price.dayHigh - analysis.price.dayLow).toFixed(5));
    }
    const activeSession = (0, sessionTimes_js_1.getActiveSession)();
    const nextSess = (0, sessionTimes_js_1.getNextSession)();
    const nextSessionLabel = nextSess ? `${nextSess.session.name} in ${nextSess.opensInMinutes}m` : null;
    return {
        symbol: analysis.symbol,
        displaySymbol: analysis.displaySymbol,
        price: analysis.price.current,
        bid: analysis.price.bid,
        ask: analysis.price.ask,
        priceUpdatedAt: analysis.price.updatedAt,
        dayHigh: analysis.price.dayHigh,
        dayLow: analysis.price.dayLow,
        directionBias: analysis.overallBias,
        directionConfidence: analysis.overallConfidence,
        technicalBias: analysis.intelligence.technicalBias.direction,
        technicalScore: analysis.intelligence.technicalBias.percentage,
        technicalSummary: analysis.intelligence.technicalBias.summary,
        marketStructure: analysis.intelligence.tradePlan.preferredDirection,
        macroBias: analysis.fundamentals.bias,
        macroConfidence: analysis.fundamentals.confidence,
        fundamentalBias: analysis.intelligence.fundamentalBias.direction,
        fundamentalConfidence: analysis.intelligence.fundamentalBias.percentage,
        fundamentalSummary: analysis.intelligence.fundamentalBias.summary,
        fundamentalReason: analysis.fundamentals.reason,
        calendarRisk,
        highImpactEvents,
        topDrivers: analysis.fundamentals.keyDrivers,
        bullishDrivers: analysis.fundamentals.bullishDrivers,
        bearishDrivers: analysis.fundamentals.bearishDrivers,
        spreadStatus,
        currentSpread,
        volatility,
        support: analysis.price.dayLow,
        resistance: analysis.price.dayHigh,
        session: activeSession?.name ?? 'Closed',
        nextSession: nextSessionLabel,
        tradeStatus: analysis.intelligence.tradeStatus,
        tradeStatusLabel: analysis.tradeStatus.label,
        verdict: analysis.intelligence.overallBias,
        verdictScore: analysis.intelligence.biasPercentage,
        reasoning: analysis.intelligence.summary,
        risks: analysis.intelligence.risks,
        invalidation: analysis.intelligence.invalidation,
        dataGeneratedAt: analysis.fundamentals.lastUpdated,
        fundamentalsUpdatedAt: analysis.fundamentals.lastUpdated,
        mode: analysis.fundamentals.mode,
    };
}
