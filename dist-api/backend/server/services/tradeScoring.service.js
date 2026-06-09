"use strict";
// Deterministic trade-scoring engine.
//
// The 6 process scores + overall are computed PURELY from the user's saved
// review data and execution facts — never hard-coded, never random, no AI call.
// This is the source of truth for every score shown in the app. The AI coach
// only writes prose (comment / main mistake / next improvement) on top of these.
//
// Rules follow the spec's "Important Logic Rules": score the process, not the
// result. A winning trade with broken rules still scores poorly on discipline;
// a losing trade that followed the plan is a valid loss.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeScores = computeScores;
const NEGATIVE_EMOTIONS = new Set([
    'FEARFUL', 'GREEDY', 'REVENGE', 'FOMO', 'ANGRY', 'FRUSTRATED', 'IMPATIENT',
    'STRESSED', 'EMOTIONAL', 'OVERCONFIDENT', 'ANXIOUS', 'REGRETFUL', 'DISAPPOINTED',
]);
const GRADE_BASE = {
    A_PLUS: 95, A: 85, B: 68, C: 50, FORCED: 25, NO_SETUP: 15,
};
function clamp(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
}
function hasTag(tags, ...names) {
    if (!tags)
        return false;
    return names.some((n) => tags.includes(n));
}
function isNegativeEmotion(emotion) {
    return emotion != null && NEGATIVE_EMOTIONS.has(emotion);
}
/** Stop loss is considered missing if absent, zero, or equal to entry. */
function stopLossMissing(input) {
    if (input.stopLoss == null || input.stopLoss === 0)
        return true;
    if (input.entryPrice != null && input.stopLoss === input.entryPrice)
        return true;
    return false;
}
function computeBlueprintMatch(input) {
    const followed = input.blueprintRulesFollowed?.length ?? 0;
    const broken = input.blueprintRulesBroken?.length ?? 0;
    const total = followed + broken;
    if (total === 0)
        return null;
    return Math.round((followed / total) * 100);
}
function blueprintGradeFromScore(score) {
    if (score == null)
        return null;
    if (score >= 90)
        return 'A+';
    if (score >= 75)
        return 'A';
    if (score >= 60)
        return 'B';
    return 'C';
}
function scoreSetup(input, blueprintMatch) {
    const grade = typeof input.setupQualityGrade === 'string' ? input.setupQualityGrade : null;
    const gradeBase = grade != null && grade in GRADE_BASE ? GRADE_BASE[grade] : 55;
    if (blueprintMatch == null)
        return clamp(gradeBase);
    // Blend the user's grade with how much of the blueprint was actually followed.
    return clamp(gradeBase * 0.6 + blueprintMatch * 0.4);
}
function scoreExecution(input) {
    let s = 70;
    if (hasTag(input.mistakeTags, 'LATE_ENTRY', 'CHASED_PRICE', 'NO_CONFIRMATION'))
        s -= 12;
    if (hasTag(input.mistakeTags, 'EARLY_EXIT', 'EMOTIONAL_EXIT'))
        s -= 10;
    if (input.movedStopLoss === true)
        s -= 12;
    if (input.closedEarly === true)
        s -= 10;
    if (input.hesitation === true)
        s -= 6;
    if (input.followedPlan === true)
        s += 10;
    else if (input.followedPlan === false)
        s -= 15;
    return clamp(s);
}
function scorePsychology(input) {
    let s = 78;
    if (input.isRevengeTrade === true)
        s -= 30;
    if (input.isFomo === true)
        s -= 20;
    if (isNegativeEmotion(input.preTradeEmotion))
        s -= 10;
    if (isNegativeEmotion(input.duringTradeEmotion))
        s -= 8;
    if (isNegativeEmotion(input.postTradeEmotion))
        s -= 4;
    if (input.preTradeEmotion === 'TIRED' || input.duringTradeEmotion === 'TIRED')
        s -= 8;
    if (input.hesitation === true)
        s -= 5;
    if (hasTag(input.mistakeTags, 'TRADED_EMOTIONAL', 'REVENGE_TRADE', 'FOMO_ENTRY'))
        s -= 10;
    return clamp(s);
}
function scoreDiscipline(input, blueprintMatch) {
    let s = 80;
    if (hasTag(input.mistakeTags, 'NO_PLAN'))
        s -= 40; // heavy, per rules
    if (input.followedPlan === false)
        s -= 25;
    else if (input.followedPlan === true)
        s += 8;
    const broken = input.blueprintRulesBroken?.length ?? 0;
    s -= broken * 6;
    if (hasTag(input.mistakeTags, 'WRONG_SESSION', 'TRADED_RED_NEWS'))
        s -= 10;
    if (hasTag(input.mistakeTags, 'BROKE_DAILY_LOSS_LIMIT', 'BROKE_MAX_RISK'))
        s -= 15;
    if (blueprintMatch != null && blueprintMatch < 60)
        s -= 8;
    return clamp(s);
}
function scoreRisk(input, flags) {
    let s = 75;
    if (stopLossMissing(input)) {
        s -= 40;
        flags.push('NO_STOP_LOSS');
    }
    if (input.riskPercent == null || input.riskPercent === 0) {
        s -= 15;
        flags.push('RISK_UNKNOWN');
    }
    else if (input.maxRiskPercent != null && input.riskPercent > input.maxRiskPercent) {
        s -= 20;
        flags.push('RISK_ABOVE_PLAN');
    }
    if (input.takeProfit == null || input.takeProfit === 0) {
        s -= 8;
        flags.push('NO_TAKE_PROFIT');
    }
    if (input.rrPlanned != null && input.rrPlanned < 1) {
        s -= 15;
        flags.push('POOR_RR');
    }
    if (hasTag(input.mistakeTags, 'OVER_LEVERAGED', 'RISK_TOO_HIGH'))
        s -= 20;
    if (hasTag(input.mistakeTags, 'BAD_RR'))
        s -= 12;
    if (hasTag(input.mistakeTags, 'MOVED_STOP', 'WIDENED_STOP') || input.movedStopLoss === true)
        s -= 15;
    return clamp(s);
}
function scorePatience(input) {
    let s = 78;
    if (hasTag(input.mistakeTags, 'LATE_ENTRY', 'CHASED_PRICE', 'FOMO_ENTRY') || input.isFomo === true)
        s -= 15;
    if (hasTag(input.mistakeTags, 'EARLY_EXIT') || input.closedEarly === true)
        s -= 15;
    if (hasTag(input.mistakeTags, 'OVERTRADED'))
        s -= 15;
    if (hasTag(input.mistakeTags, 'NO_CONFIRMATION'))
        s -= 10;
    if (input.hesitation === true)
        s -= 5;
    if (input.preTradeEmotion === 'IMPATIENT' || input.duringTradeEmotion === 'IMPATIENT')
        s -= 10;
    return clamp(s);
}
function suggestLossClassification(input, blueprintMatch, riskScore, disciplineScore, psychologyScore) {
    const isLoss = (input.pnl ?? 0) < 0;
    if (!isLoss)
        return null;
    const noMistakes = (input.mistakeTags?.length ?? 0) === 0;
    const planFollowed = input.followedPlan === true;
    const goodBlueprint = blueprintMatch == null || blueprintMatch >= 80;
    if (planFollowed && noMistakes && goodBlueprint)
        return 'VALID_LOSS';
    if (hasTag(input.mistakeTags, 'NO_PLAN') || input.followedPlan === false)
        return 'RULE_VIOLATION';
    if (riskScore < 50)
        return 'RISK';
    if (psychologyScore < 50 || input.isRevengeTrade === true || input.isFomo === true)
        return 'PSYCHOLOGY';
    if (disciplineScore < 50)
        return 'STRATEGY';
    return 'EXECUTION';
}
/**
 * Compute all process scores deterministically from a trade's review data.
 * Pure function — same input always yields the same output.
 */
function computeScores(input) {
    const flags = [];
    const blueprintMatchScore = computeBlueprintMatch(input);
    const setupQuality = scoreSetup(input, blueprintMatchScore);
    const executionScore = scoreExecution(input);
    const psychologyScore = scorePsychology(input);
    const disciplineScore = scoreDiscipline(input, blueprintMatchScore);
    const riskScore = scoreRisk(input, flags);
    const patienceScore = scorePatience(input);
    if (blueprintMatchScore != null && blueprintMatchScore < 60)
        flags.push('LOW_BLUEPRINT_MATCH');
    if ((input.pnl ?? 0) > 0 && (input.followedPlan === false || hasTag(input.mistakeTags, 'NO_PLAN'))) {
        flags.push('PROFITABLE_BUT_UNDISCIPLINED');
    }
    if (input.setupQualityGrade === 'FORCED' || input.setupQualityGrade === 'NO_SETUP') {
        flags.push('FORCED_TRADE');
    }
    const overallScore = clamp(setupQuality * 0.2 +
        executionScore * 0.2 +
        psychologyScore * 0.2 +
        disciplineScore * 0.2 +
        riskScore * 0.15 +
        patienceScore * 0.05);
    const suggestedLossClassification = suggestLossClassification(input, blueprintMatchScore, riskScore, disciplineScore, psychologyScore);
    return {
        setupQuality,
        executionScore,
        psychologyScore,
        disciplineScore,
        riskScore,
        patienceScore,
        overallScore,
        blueprintMatchScore,
        blueprintGrade: blueprintGradeFromScore(blueprintMatchScore),
        flags,
        suggestedLossClassification,
    };
}
