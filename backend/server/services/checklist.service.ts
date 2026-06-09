import { chatComplete } from '../lib/gemini.js';
import { supabase } from '../lib/supabase.js';

export interface ChecklistInput {
  symbol: string;
  htfBiasAligned: boolean;
  liquiditySweepConfirmed: boolean;
  bosChochConfirmed: boolean;
  sessionValid: boolean;
  rrMeetsMinimum: boolean;
  newsRiskChecked: boolean;
  emotionalStateOk: boolean;
  notRevengeTrade: boolean;
  notFomo: boolean;
  riskSizedCorrectly: boolean;
  entryTimeframeAligned: boolean;
  keyLevelPresent: boolean;
  notes?: string;
}

function computeReadinessScore(input: ChecklistInput): number {
  const weights: Record<keyof Omit<ChecklistInput, 'symbol' | 'notes'>, number> = {
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
    if (input[key as keyof typeof input]) score += weight;
  }
  return score;
}

export async function createChecklist(userId: string, input: ChecklistInput) {
  const readinessScore = computeReadinessScore(input);

  let aiValidation: string | undefined;
  if (readinessScore < 80) {
    const failed = Object.entries(input)
      .filter(([k, v]) => typeof v === 'boolean' && !v)
      .map(([k]) => k);

    const prompt = `A trader wants to enter a ${input.symbol} trade but failed these checklist items: ${failed.join(', ')}.
Readiness score: ${readinessScore}/100.
Give a 2-sentence coaching note. Should they take this trade? Be direct.`;

    const msg = await chatComplete(
      [{ role: 'user', content: prompt }],
      { maxTokens: 150, temperature: 0.2, jsonMode: false, feature: 'checklist', operation: 'validate_trade' }
    );
    aiValidation = msg.content || undefined;
  } else {
    aiValidation = `Checklist passed with ${readinessScore}/100. All critical conditions met. Proceed with your plan and manage risk precisely.`;
  }

  const { data, error } = await supabase
    .from('pre_trade_checklists')
    .insert({ userId, ...input, readinessScore, aiValidation })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getChecklists(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from('pre_trade_checklists')
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getChecklistById(userId: string, id: string) {
  const { data, error } = await supabase
    .from('pre_trade_checklists')
    .select('*')
    .eq('id', id)
    .eq('userId', userId)
    .single();
  if (error || !data) throw new Error('Checklist not found');
  return data;
}
