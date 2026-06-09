import { supabase } from '../lib/supabase.js';

// Trading Blueprint setups. Persisted per-user in the `playbook_setups` table
// so the journal can populate its setup dropdown + checklist dynamically.
//
// Column mapping for the journal:
//   rules         → the blueprint checklist (rendered as followed / not-followed toggles)
//   confirmations → entry confirmation rules
//   invalidations → conditions that invalidate the setup
//   sessions      → valid trading sessions
//   tags          → preferred pairs / free tags

export interface SetupInput {
  name: string;
  description?: string;
  category?: string;
  rules?: string[];
  confirmations?: string[];
  invalidations?: string[];
  timeframes?: string[];
  sessions?: string[];
  tags?: string[];
  notes?: string;
  isActive?: boolean;
}

// Valid grade categories for the blueprint system
const BLUEPRINT_CATEGORIES = new Set(['A_PLUS', 'A', 'B', 'C']);

// Old directional setup names to archive (not delete) when migrating to canonical setups
const DIRECTIONAL_NAMES = new Set([
  'A+ Sell — Supply + High Sweep + Bearish CHOCH',
  'A+ Buy — Demand + Low Sweep + Bullish CHOCH',
  'A Sell — POI + Sweep + Bearish CHOCH',
  'A Buy — POI + Sweep + Bullish CHOCH',
  'B Sell — Strong POI + Bearish CHOCH (Weak Sweep)',
  'B Buy — Strong POI + Bullish CHOCH (Weak Sweep)',
]);

// Canonical blueprint setups — one per grade, direction is always dynamic
const DEFAULT_SETUPS: SetupInput[] = [
  {
    name: 'A+ Setup — Premium POI + Liquidity Sweep + CHOCH',
    category: 'A_PLUS',
    description:
      'Highest quality setup. Price reaches a valid HTF POI, sweeps liquidity, rejects strongly, confirms CHOCH with displacement, and provides FVG or retest entry confirmation.',
    tags: ['DYNAMIC', 'HTF_ALIGNED', 'SWEEP_REQUIRED', 'CHOCH_REQUIRED', 'A_PLUS'],
    timeframes: ['W', 'D', '4H', '1H', '5M', '1M'],
    sessions: ['LONDON', 'NEW_YORK', 'OVERLAP'],
    rules: [
      'HTF bias is clearly defined',
      'LTF aligns with selected trade direction',
      'Price reaches valid HTF supply or demand zone',
      'Relevant Asian or London liquidity is swept',
      'Strong rejection from POI',
      'CHOCH confirmed on 1M or 5M',
      'CHOCH candle closes clearly beyond structure',
      'Displacement candle present',
      'FVG or retest of CHOCH level confirms entry',
      'Stop loss placed beyond sweep extreme',
      'Take profit targets opposite liquidity',
      'RR minimum 2R confirmed',
      'No high-impact news within 30 minutes',
      'No revenge trade — one setup at a time',
    ],
    confirmations: [
      'CHOCH on 1M or 5M after liquidity sweep',
      'CHOCH candle fully closed',
      'FVG present in displacement move',
      'Retest of CHOCH level holds',
      'Displacement momentum is clear',
    ],
    invalidations: [
      'No CHOCH confirmation — no trade',
      'CHOCH candle has not closed',
      'HTF bias not clearly defined',
      'No valid POI or supply/demand zone',
      'No liquidity sweep',
      'High-impact news within 30 minutes',
      'RR below 2R',
      'Stop loss not beyond sweep extreme',
      'Revenge trade or emotional state',
      'Second trade already open',
    ],
    notes:
      'Best quality setup. All conditions must be present. Direction is dynamic: use buy logic at demand after low sweep and bullish CHOCH; use sell logic at supply after high sweep and bearish CHOCH.',
    isActive: true,
  },
  {
    name: 'A Setup — POI + Sweep + CHOCH',
    category: 'A',
    description:
      'High quality setup. Price reaches a valid POI, liquidity sweep is present, CHOCH confirms the direction, and FVG or retest provides entry confirmation.',
    tags: ['DYNAMIC', 'HTF_ALIGNED', 'SWEEP_REQUIRED', 'CHOCH_REQUIRED', 'A'],
    timeframes: ['D', '4H', '1H', '5M', '1M'],
    sessions: ['LONDON', 'NEW_YORK', 'OVERLAP'],
    rules: [
      'HTF bias is clear',
      'LTF aligns with selected trade direction',
      'Price reaches valid POI or supply/demand zone',
      'Liquidity sweep is present',
      'CHOCH confirmed after sweep',
      'CHOCH candle closes beyond structure',
      'FVG or retest confirms entry',
      'Stop loss beyond sweep or structure extreme',
      'Take profit targets opposite liquidity',
      'RR minimum 2R',
      'No revenge trade',
    ],
    confirmations: [
      'CHOCH confirmed',
      'CHOCH candle closed',
      'FVG or retest present',
      'HTF bias supports selected direction',
    ],
    invalidations: [
      'No CHOCH confirmation',
      'CHOCH candle not closed',
      'HTF bias not clear',
      'No POI or supply/demand zone',
      'High-impact news within 30 minutes',
      'RR below 2R',
    ],
    notes:
      'Valid tradable setup. Direction is dynamic and determined by the chart: buy from demand after low sweep and bullish CHOCH; sell from supply after high sweep and bearish CHOCH.',
    isActive: true,
  },
  {
    name: 'B Setup — Strong POI + CHOCH',
    category: 'B',
    description:
      'Minimum tradable setup. Strong supply/demand POI reaction with CHOCH. Liquidity sweep may be weak or missing, so confidence is reduced.',
    tags: ['DYNAMIC', 'CHOCH_REQUIRED', 'B', 'REDUCED_CONFIDENCE'],
    timeframes: ['4H', '1H', '5M', '1M'],
    sessions: ['LONDON', 'NEW_YORK'],
    rules: [
      'HTF bias is clear or mostly clear',
      'Price reacts from strong supply/demand, premium/discount zone, or POI',
      'Sweep may be missing or not clean',
      'CHOCH confirmed — mandatory',
      'CHOCH candle closes beyond structure — mandatory',
      'At least one confirmation: FVG, retest, or mini supply/demand',
      'Stop loss beyond structure extreme',
      'RR minimum 2R — mandatory',
      'No revenge trade',
    ],
    confirmations: [
      'CHOCH confirmed and candle closed',
      'At least one of: FVG, retest, or mini supply/demand',
      'Strong POI reaction visible',
    ],
    invalidations: [
      'No CHOCH — invalid regardless of setup',
      'CHOCH candle not closed',
      'RR below 2R',
      'HTF and LTF strongly conflict',
      'No confirmation at all (no FVG, no retest)',
    ],
    notes:
      'Reduced confidence — minimum tradable. Direction is dynamic and determined by whether price reacts from supply with bearish CHOCH or demand with bullish CHOCH.',
    isActive: true,
  },
  {
    name: 'C Setup — Invalid / Do Not Trade',
    category: 'C',
    description: 'This setup is invalid. One or more mandatory conditions are missing. Do not risk capital.',
    tags: ['DYNAMIC', 'DO_NOT_TRADE', 'C', 'INVALID'],
    timeframes: [],
    sessions: [],
    rules: [
      'No clear HTF bias OR HTF/LTF conflict',
      'No valid POI identified',
      'No liquidity sweep and weak POI reaction',
      'No CHOCH — trade is invalid',
      'CHOCH candle has not closed — wait',
      'No displacement candle',
      'No FVG or retest confirmation',
      'RR below 2R — do not trade',
      'Stop loss not beyond valid invalidation',
      'High-impact news nearby',
      'Emotional state — revenge or FOMO detected',
      'Multiple trades already open',
    ],
    confirmations: [],
    invalidations: [
      'No CHOCH = immediate invalidation',
      'RR below 2R = immediate invalidation',
      'News risk present = wait',
      'Emotional state = do not trade',
    ],
    notes: 'C Setup — DO NOT TRADE. Close the charts, step away, and wait for a valid setup.',
    isActive: true,
  },
];

export async function listSetups(userId: string, includeInactive = false) {
  let query = supabase.from('playbook_setups').select('*').eq('userId', userId);
  if (!includeInactive) query = query.eq('isActive', true);
  const { data, error } = await query.order('createdAt', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSetup(userId: string, id: string) {
  const { data, error } = await supabase
    .from('playbook_setups').select('*').eq('id', id).eq('userId', userId).single();
  if (error || !data) throw new Error('Setup not found');
  return data;
}

function toRow(userId: string, input: SetupInput) {
  return {
    userId,
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? 'CUSTOM',
    rules: input.rules ?? [],
    confirmations: input.confirmations ?? [],
    invalidations: input.invalidations ?? [],
    timeframes: input.timeframes ?? [],
    sessions: input.sessions ?? [],
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
  };
}

export async function createSetup(userId: string, input: SetupInput) {
  const { data, error } = await supabase
    .from('playbook_setups').insert(toRow(userId, input)).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSetup(userId: string, id: string, input: Partial<SetupInput>) {
  await getSetup(userId, id); // ownership check
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const keys: (keyof SetupInput)[] = [
    'name', 'description', 'category', 'rules', 'confirmations', 'invalidations',
    'timeframes', 'sessions', 'tags', 'notes', 'isActive',
  ];
  for (const k of keys) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  const { data, error } = await supabase
    .from('playbook_setups').update(patch).eq('id', id).eq('userId', userId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteSetup(userId: string, id: string) {
  await getSetup(userId, id);
  const { error } = await supabase.from('playbook_setups').delete().eq('id', id).eq('userId', userId);
  if (error) throw new Error(error.message);
}

async function archiveSetupIds(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('playbook_setups')
    .update({ isActive: false, updatedAt: new Date().toISOString() })
    .in('id', ids)
    .eq('userId', userId);
  if (error) throw new Error(error.message);
}

async function upsertCanonicalSetup(
  userId: string,
  existing: Array<{ id: string; name: string }>,
  setup: SetupInput,
) {
  const found = existing.find(s => s.name === setup.name);
  if (found) {
    const { error } = await supabase
      .from('playbook_setups')
      .update({ ...toRow(userId, setup), updatedAt: new Date().toISOString() })
      .eq('id', found.id)
      .eq('userId', userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('playbook_setups')
      .insert(toRow(userId, setup));
    if (error) throw new Error(error.message);
  }
}

/**
 * Insert the canonical blueprint setups (one per grade A+/A/B/C).
 *
 * Safety contract:
 * - Old directional duplicates (A+ Sell/Buy, A Sell/Buy, B Sell/Buy) are archived
 *   (isActive=false) rather than deleted, so any trades referencing those IDs
 *   remain intact.
 * - If canonical setups already exist and are active, this is a no-op.
 */
export async function seedDefaultSetups(userId: string) {
  const existing = await listSetups(userId, true); // include inactive rows

  const canonicalNames = new Set(DEFAULT_SETUPS.map(s => s.name));
  const activeCanonical = existing.filter(s => s.isActive && canonicalNames.has(s.name));
  if (activeCanonical.length === DEFAULT_SETUPS.length) {
    return existing.filter(s => s.isActive);
  }

  const directionalIds = existing
    .filter(s => s.isActive && DIRECTIONAL_NAMES.has(s.name))
    .map(s => s.id);
  await archiveSetupIds(userId, directionalIds);

  const legacyIds = existing
    .filter(s => s.isActive && !BLUEPRINT_CATEGORIES.has(s.category))
    .map(s => s.id);
  await archiveSetupIds(userId, legacyIds);

  for (const setup of DEFAULT_SETUPS) {
    await upsertCanonicalSetup(userId, existing, setup);
  }

  const { data: refreshed, error: refreshErr } = await supabase
    .from('playbook_setups')
    .select('*')
    .eq('userId', userId)
    .eq('isActive', true)
    .order('createdAt', { ascending: true });
  if (refreshErr) throw new Error(refreshErr.message);
  return refreshed ?? [];
}

/**
 * Recompute the rollup performance stats for a setup from its closed trades.
 * Called after a trade review is completed so the blueprint reflects reality.
 */
export async function recomputeSetupStats(userId: string, setupId: string) {
  const { data: trades } = await supabase
    .from('trades').select('pnl, rrActual, status')
    .eq('userId', userId).eq('setupId', setupId).eq('status', 'CLOSED');
  const t = trades ?? [];
  const total = t.length;
  if (total === 0) {
    await supabase.from('playbook_setups')
      .update({ totalTrades: 0, winRate: 0, avgRR: 0, profitFactor: 0, expectancy: 0, updatedAt: new Date().toISOString() })
      .eq('id', setupId).eq('userId', userId);
    return;
  }
  const wins = t.filter((x) => (x.pnl ?? 0) > 0);
  const rr = t.filter((x) => x.rrActual != null).map((x) => x.rrActual as number);
  const winRate = wins.length / total;
  const avgRR = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
  const grossWin = t.filter((x) => (x.pnl ?? 0) > 0).reduce((s, x) => s + (x.pnl ?? 0), 0);
  const grossLoss = Math.abs(t.filter((x) => (x.pnl ?? 0) < 0).reduce((s, x) => s + (x.pnl ?? 0), 0));
  let profitFactor: number;
  if (grossLoss > 0) {
    profitFactor = grossWin / grossLoss;
  } else {
    profitFactor = grossWin > 0 ? 999 : 0;
  }
  const expectancy = winRate * avgRR - (1 - winRate);
  await supabase.from('playbook_setups').update({
    totalTrades: total,
    winRate: Math.round(winRate * 1000) / 10,
    avgRR: Math.round(avgRR * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    updatedAt: new Date().toISOString(),
  }).eq('id', setupId).eq('userId', userId);
}
