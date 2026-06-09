import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../lib/supabase.js';
import { getPerformanceStats, getTrades } from './tradeJournal.service.js';
import { computeScores } from './tradeScoring.service.js';
import { detectMistakePatterns } from './analytics.service.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MARKET_GUARDRAIL = 'Never predict future market movements or price targets.';

// ─── Per-trade AI review ───────────────────────────────────────────────────
//
// Scores are computed DETERMINISTICALLY by the scoring engine (never by the
// model, never hard-coded). The AI only writes prose: a short coach comment,
// the single main mistake, and one improvement for next time. Scores are
// recomputed and persisted here so a standalone "re-run review" stays in sync.

export async function reviewTrade(userId: string, tradeId: string): Promise<string> {
  const { data: trade, error } = await supabase
    .from('trades').select('*').eq('id', tradeId).eq('userId', userId).single();
  if (error || !trade) throw new Error('Trade not found');

  const { data: profile } = await supabase
    .from('user_profiles').select('*').eq('userId', userId).single();

  const scores = computeScores({
    stopLoss: trade.stopLoss, takeProfit: trade.takeProfit, entryPrice: trade.entryPrice,
    riskPercent: trade.riskPercent, rrPlanned: trade.rrPlanned, pnl: trade.pnl, session: trade.session,
    setupQualityGrade: trade.setupQualityGrade,
    blueprintRulesFollowed: trade.blueprintRulesFollowed, blueprintRulesBroken: trade.blueprintRulesBroken,
    preTradeEmotion: trade.preTradeEmotion, duringTradeEmotion: trade.duringTradeEmotion,
    postTradeEmotion: trade.postTradeEmotion, isRevengeTrade: trade.isRevengeTrade, isFomo: trade.isFomo,
    hesitation: trade.hesitation, movedStopLoss: trade.movedStopLoss, closedEarly: trade.closedEarly,
    followedPlan: trade.followedPlan, mistakeTags: trade.mistakeTags,
    maxRiskPercent: profile?.riskPerTradePercent ?? null,
  });

  const pnlValue = trade.pnl ?? 0;
  let result = 'BREAKEVEN';
  if (pnlValue > 0) result = 'WIN';
  else if (pnlValue < 0) result = 'LOSS';

  const prompt = `You are an elite discretionary trading coach reviewing one trade. ${MARKET_GUARDRAIL}
The process scores below were already computed objectively from the trader's review data — do NOT restate or invent scores. Write only honest, specific prose that explains the scores and tells the trader what to fix. Score the PROCESS, not the result.

TRADE: ${trade.symbol} ${trade.direction} | ${result} | P&L:${trade.pnl ?? 'N/A'} (${trade.pnlPercent ?? 'N/A'}%) | RR planned:${trade.rrPlanned} actual:${trade.rrActual ?? 'N/A'}
SETUP: ${trade.setupName ?? trade.setupType} | grade:${trade.setupQualityGrade ?? 'N/A'} | blueprint match:${scores.blueprintMatchScore ?? 'N/A'}%
PSYCH: pre:${trade.preTradeEmotion} during:${trade.duringTradeEmotion ?? 'N/A'} post:${trade.postTradeEmotion ?? 'N/A'} | confidence:${trade.confidenceLevel}/10 | revenge:${trade.isRevengeTrade} fomo:${trade.isFomo} hesitation:${trade.hesitation ?? false} movedSL:${trade.movedStopLoss ?? false} closedEarly:${trade.closedEarly ?? false}
PLAN FOLLOWED: ${trade.followedPlan ?? 'N/A'} | mistakes:${(trade.mistakeTags ?? []).join(',') || 'none'} | lossClass:${trade.lossClassification ?? 'N/A'}
NARRATIVE: entry="${trade.reasonForEntry ?? 'N/A'}" exit="${trade.reasonForExit ?? 'N/A'}"
COMPUTED SCORES: setup:${scores.setupQuality} execution:${scores.executionScore} psychology:${scores.psychologyScore} discipline:${scores.disciplineScore} risk:${scores.riskScore} patience:${scores.patienceScore} overall:${scores.overallScore}
FLAGS: ${scores.flags.join(',') || 'none'}
Trader rules: ${(profile?.tradingRules ?? []).join(';') || 'none'}

Respond EXACTLY in this format (no extra lines):
COMMENT: [2-4 sentence honest coach comment explaining the scores]
MAIN MISTAKE: [one sentence — the single biggest issue, or "None — disciplined trade" if clean]
NEXT IMPROVEMENT: [one concrete, actionable thing to do on the next trade]`;

  let comment = '';
  let mainMistake = '';
  let nextImprovement = '';
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });
    const firstBlock = response.content[0];
    const text = firstBlock.type === 'text' ? firstBlock.text : '';
    const grab = (label: string) => {
      const match = new RegExp(String.raw`${label}:\s*(.+?)(?=\n[A-Z ]+:|$)`, 's').exec(text);
      return match ? match[1].trim() : '';
    };
    comment = grab('COMMENT') || text.trim();
    mainMistake = grab('MAIN MISTAKE');
    nextImprovement = grab('NEXT IMPROVEMENT');
  } catch {
    comment = 'AI commentary unavailable. Scores were computed from your review data.';
  }

  const { error: updErr } = await supabase.from('trades').update({
    setupQuality: scores.setupQuality,
    executionScore: scores.executionScore,
    psychologyScore: scores.psychologyScore,
    disciplineScore: scores.disciplineScore,
    riskScore: scores.riskScore,
    patienceScore: scores.patienceScore,
    overallScore: scores.overallScore,
    aiScore: scores.overallScore,
    blueprintMatchScore: scores.blueprintMatchScore,
    aiReview: comment,
    aiMainMistake: mainMistake || null,
    aiNextImprovement: nextImprovement || null,
  }).eq('id', tradeId).eq('userId', userId);
  if (updErr) throw new Error(updErr.message);

  return comment;
}

// ─── Weekly coaching session ───────────────────────────────────────────────

export async function generateWeeklyCoaching(userId: string, weekStr?: string): Promise<string> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const period = weekStr ?? `${weekStart.toISOString().slice(0, 10)}_${weekEnd.toISOString().slice(0, 10)}`;

  const { data: existing } = await supabase
    .from('coaching_sessions').select('content').eq('userId', userId).eq('period', period).eq('type', 'WEEKLY').single();
  if (existing) return existing.content;

  const { trades: tradesResult } = await getTrades(userId, { from: weekStart.toISOString(), to: weekEnd.toISOString(), limit: 50 });
  const stats = await getPerformanceStats(userId, weekStart.toISOString(), weekEnd.toISOString());
  const patterns = await detectMistakePatterns(userId);
  const { data: profile } = await supabase.from('user_profiles').select('*').eq('userId', userId).single();

  const systemPrompt = `You are an elite discretionary trading coach writing a weekly coaching letter. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset only. Mentor tone, honest, actionable.`;

  const userPrompt = `Weekly trading coaching letter (300-500 words).

Week ${period}: ${stats.totalTrades} trades | ${stats.winCount}W/${stats.lossCount}L | WR:${stats.winRate}% | PnL:${stats.totalPnl} | PF:${stats.profitFactor} | AvgRR:${stats.avgRR}
Trades: ${tradesResult?.slice(0, 10).map((t: any) => `${t.symbol}${t.direction}(${t.preTradeEmotion},${(t.mistakeTags ?? []).join(',') || 'ok'})`).join(' | ') || 'none'}
Patterns: ${patterns.join('; ') || 'none'} | Rules: ${(profile?.tradingRules ?? []).join(';') || 'none'}

Cover: performance reality, behavioral patterns, top 3 strengths, top 3 fixes, one drill for next week, mindset note.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const firstBlock = response.content[0];
  const content = firstBlock.type === 'text' ? firstBlock.text : '';

  await supabase.from('coaching_sessions').insert({
    userId, type: 'WEEKLY', period,
    title: `Week of ${weekStart.toISOString().slice(0, 10)}`,
    content, tradesAnalyzed: stats.totalTrades,
    keyInsights: patterns,
    warningFlags: patterns.filter(p => p.includes('streak') || p.includes('Revenge')),
  });

  return content;
}

// ─── Daily debrief ────────────────────────────────────────────────────────

export async function generateDailyDebrief(userId: string, date?: string): Promise<string> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;

  const { trades: tradesResult } = await getTrades(userId, { from, to, limit: 20 });
  const stats = await getPerformanceStats(userId, from, to);
  const patterns = await detectMistakePatterns(userId);

  if (stats.totalTrades === 0) return 'No trades today. Rest days are part of the process.';

  const systemPrompt = `You are an elite discretionary trading coach writing an end-of-day debrief. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset only. Be direct and actionable.`;

  const userPrompt = `End-of-day debrief (150-200 words).

${day}: ${stats.totalTrades} trades ${stats.winCount}W/${stats.lossCount}L WR:${stats.winRate}% PnL:${stats.totalPnl} AvgRR:${stats.avgRR}
${tradesResult?.map((t: any) => `${t.symbol}${t.direction} pnl:${t.pnl ?? 'open'} emotion:${t.preTradeEmotion} mistakes:${(t.mistakeTags ?? []).join(',') || 'none'}`).join(' | ') || ''}
Warnings: ${patterns.join(';') || 'none'}

Cover: what worked, one fix for tomorrow, one focus for next session.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 350,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const firstBlock = response.content[0];
  return firstBlock.type === 'text' ? firstBlock.text : '';
}

// ─── Ask the coach ─────────────────────────────────────────────────────────

export async function askCoach(userId: string, question: string): Promise<string> {
  const stats = await getPerformanceStats(userId);
  const patterns = await detectMistakePatterns(userId);
  const { data: profile } = await supabase.from('user_profiles').select('*').eq('userId', userId).single();

  const system = `You are an elite discretionary trading coach. Never predict markets or give trade signals. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset.
Trader: WR:${stats.winRate}% AvgRR:${stats.avgRR} PF:${stats.profitFactor} Trades:${stats.totalTrades}
Patterns: ${patterns.join(';') || 'none'} | Rules: ${(profile?.tradingRules ?? []).join(';') || 'none'}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    temperature: 0.3,
    system,
    messages: [{ role: 'user', content: question }],
  });

  const firstBlock = response.content[0];
  return firstBlock.type === 'text' ? firstBlock.text : '';
}
