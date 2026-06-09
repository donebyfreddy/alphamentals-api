"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateJournalInsights = generateJournalInsights;
const gemini_js_1 = require("../lib/gemini.js");
const tradeJournal_service_js_1 = require("./tradeJournal.service.js");
const analytics_service_js_1 = require("./analytics.service.js");
const FALLBACK = {
    doingWell: 'Not enough reviewed trades yet — complete a few post-trade reviews to unlock insights.',
    biggestMistake: 'N/A',
    focusSetup: 'N/A',
    avoidSetup: 'N/A',
    worstEmotion: 'N/A',
    bestSession: 'N/A',
    carefulDay: 'N/A',
    oneRuleToFix: 'Complete a post-trade review on every closed trade.',
    weeklyFocus: 'Build the habit of reviewing every trade against your blueprint.',
};
/**
 * Generate an AI performance-insights summary from aggregated journal analytics.
 * Answers the dashboard's key questions: what's working, the biggest mistake,
 * which setup to focus on / avoid, worst emotion, best session, the one rule to
 * fix, and the focus for the week.
 */
async function generateJournalInsights(userId) {
    const [stats, setups, setupQuality, mistakeCost, psychology, discipline, sessions, days, patterns] = await Promise.all([
        (0, tradeJournal_service_js_1.getPerformanceStats)(userId),
        (0, analytics_service_js_1.getSetupPerformance)(userId),
        (0, analytics_service_js_1.getSetupQualityPerformance)(userId),
        (0, analytics_service_js_1.getMistakeCost)(userId),
        (0, analytics_service_js_1.getPsychologyByPhase)(userId, 'pre'),
        (0, analytics_service_js_1.getDisciplineStats)(userId),
        (0, analytics_service_js_1.getSessionHeatmap)(userId),
        (0, analytics_service_js_1.getDayOfWeekHeatmap)(userId),
        (0, analytics_service_js_1.detectMistakePatterns)(userId),
    ]);
    if (stats.totalTrades < 3)
        return FALLBACK;
    const summary = {
        stats,
        setups,
        setupQuality,
        topMistakesByCost: mistakeCost.slice(0, 5),
        psychologyByEmotion: psychology,
        discipline,
        sessions,
        days,
        patterns,
    };
    const system = `You are an elite discretionary trading performance analyst. Analyse the trader's aggregated journal data and answer concisely. Be specific and quote real numbers from the data (win rates, P/L, counts). Never predict markets. Score process over outcome. Respond ONLY with a JSON object using these exact keys: doingWell, biggestMistake, focusSetup, avoidSetup, worstEmotion, bestSession, carefulDay, oneRuleToFix, weeklyFocus. Each value is one or two sentences.`;
    try {
        const result = await (0, gemini_js_1.chatCompleteJSON)([
            { role: 'system', content: system },
            { role: 'user', content: `Journal data:\n${JSON.stringify(summary)}` },
        ], { maxTokens: 900, temperature: 0.3, feature: 'journal', operation: 'generate_insights' });
        return { ...FALLBACK, ...result };
    }
    catch {
        return FALLBACK;
    }
}
