import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { createTrade } from './tradeJournal.service.js';
import {
  DEFAULT_EXECUTION_SETTINGS,
  validateTradeExecutionPlan,
  type TradeExecutionPlan,
  type TradeExecutionValidation,
} from '../../../src/lib/tradeExecutionRules.js';

export interface ExecuteTradeResponse {
  success: boolean;
  allowed: boolean;
  status: 'BLOCKED' | 'EXECUTED';
  tradeId?: string;
  journalId?: string;
  metaApiOrderId?: string;
  accountabilityLogId?: string;
  blockingReasons: string[];
  warnings: string[];
  validation: TradeExecutionValidation;
  message: string;
}

const completedResponses = new Map<string, ExecuteTradeResponse>();

function isLiveExecutionEnabled(plan: TradeExecutionPlan) {
  return Boolean(
    plan.settings.liveExecutionEnabled &&
    !plan.settings.paperMode &&
    process.env.METAAPI_ENABLED === 'true',
  );
}

async function findExistingByIdempotency(userId: string, key: string): Promise<ExecuteTradeResponse | null> {
  if (completedResponses.has(key)) return completedResponses.get(key)!;

  const { data } = await supabase
    .from('trade_accountability_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (!data) return null;
  const response = (data.response_payload ?? null) as ExecuteTradeResponse | null;
  if (response) completedResponses.set(key, response);
  return response;
}

async function writeAccountabilityLog(params: {
  plan: TradeExecutionPlan;
  validation: TradeExecutionValidation;
  status: 'BLOCKED' | 'EXECUTED';
  executionAttempted: boolean;
  metaApiResponse?: unknown;
  journalId?: string | null;
  response?: ExecuteTradeResponse | null;
}) {
  const id = randomUUID();
  const { plan, validation } = params;
  const payload = {
    id,
    user_id: plan.userId,
    account_id: plan.account?.id ?? null,
    idempotency_key: plan.idempotencyKey,
    symbol: plan.symbol,
    direction: plan.direction,
    requested_risk_percent: plan.riskPercent,
    setup_grade: plan.setupGrade || null,
    trade_health_score: validation.tradeHealthScore,
    final_status: params.status,
    blocking_reasons: validation.blockingReasons,
    warnings: [...validation.warnings, ...validation.overrideableWarnings],
    override_requested: Boolean(plan.override?.requested),
    override_reason: plan.override?.reason ?? null,
    execution_attempted: params.executionAttempted,
    metaapi_response: params.metaApiResponse ?? null,
    journal_id: params.journalId ?? null,
    plan_payload: plan,
    validation_payload: validation,
    response_payload: params.response ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('trade_accountability_logs')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    console.error('[trade-execution] Failed to write accountability log:', error.message);
    return id;
  }
  return (data as { id?: string } | null)?.id ?? id;
}

async function updateAccountabilityResponse(id: string | undefined, response: ExecuteTradeResponse) {
  if (!id) return;
  const { error } = await supabase
    .from('trade_accountability_logs')
    .update({ response_payload: response })
    .eq('id', id);
  if (error) console.error('[trade-execution] Failed to update accountability response:', error.message);
}

export async function executeAccountableTrade(plan: TradeExecutionPlan): Promise<ExecuteTradeResponse> {
  const existing = await findExistingByIdempotency(plan.userId, plan.idempotencyKey);
  if (existing) return existing;

  const runtimePlan: TradeExecutionPlan = {
    ...plan,
    settings: { ...DEFAULT_EXECUTION_SETTINGS, ...plan.settings },
  };

  runtimePlan.marketGate = {
    ...runtimePlan.marketGate,
    isExecutionBridgeConnected: false,
    isMetaApiConnected: false,
  };

  const validation = validateTradeExecutionPlan(runtimePlan);
  if (!validation.allowed) {
    const response: ExecuteTradeResponse = {
      success: false,
      allowed: false,
      status: 'BLOCKED',
      blockingReasons: validation.blockingReasons,
      warnings: [...validation.warnings, ...validation.overrideableWarnings],
      validation,
      message: 'Trade blocked by AlphaMentals accountability rules.',
    };
    const logId = await writeAccountabilityLog({
      plan: runtimePlan,
      validation,
      status: 'BLOCKED',
      executionAttempted: false,
      response,
    });
    response.accountabilityLogId = logId;
    await updateAccountabilityResponse(logId, response);
    completedResponses.set(plan.idempotencyKey, response);
    return response;
  }

  const live = isLiveExecutionEnabled(runtimePlan);
  let metaApiResponse: { success: boolean; orderId?: string; message?: string; raw?: unknown } = {
    success: true,
    orderId: `paper-${randomUUID()}`,
    message: 'Paper execution recorded. Live broker execution is disabled. This deployment uses Windows VPS MetaTrader 5 only.',
  };

  if (live) {
    metaApiResponse = {
      success: false,
      raw: { ok: false, error: 'METAAPI_DISABLED' },
      message: 'MetaApi is disabled. This deployment uses Windows VPS MetaTrader 5 only.',
    };
  }

  if (!metaApiResponse.success) {
    const failedValidation = {
      ...validation,
      allowed: false,
      status: 'BLOCKED' as const,
      blockingReasons: [metaApiResponse.message ?? 'Live broker execution is disabled.'],
    };
    const response: ExecuteTradeResponse = {
      success: false,
      allowed: false,
      status: 'BLOCKED',
      blockingReasons: failedValidation.blockingReasons,
      warnings: validation.warnings,
      validation: failedValidation,
      message: metaApiResponse.message ?? 'Live broker execution is disabled.',
    };
    const logId = await writeAccountabilityLog({
      plan: runtimePlan,
      validation: failedValidation,
      status: 'BLOCKED',
      executionAttempted: true,
      metaApiResponse,
      response,
    });
    response.accountabilityLogId = logId;
    await updateAccountabilityResponse(logId, response);
    completedResponses.set(plan.idempotencyKey, response);
    return response;
  }

  const journal = await createTrade(runtimePlan.userId, {
    symbol: runtimePlan.symbol,
    direction: runtimePlan.direction,
    entryPrice: runtimePlan.entryPrice,
    stopLoss: runtimePlan.stopLoss!,
    takeProfit: runtimePlan.takeProfit!,
    positionSize: validation.risk.finalLotSize,
    riskPercent: runtimePlan.riskPercent,
    session: runtimePlan.session === 'New York' ? 'NEW_YORK' : runtimePlan.session === 'Overlap' ? 'LONDON_NY_OVERLAP' : runtimePlan.session.toUpperCase() as 'LONDON' | 'ASIA',
    timeframe: 'Execution Gate',
    setupType: runtimePlan.setupName || runtimePlan.setupGrade,
    confluences: Object.entries(runtimePlan.playbookChecks).filter(([, value]) => value).map(([key]) => key),
    tags: ['AlphaMentals Execution', live ? 'Live Execution Requested' : 'Paper Mode'],
    preTradeEmotion: 'CALM',
    confidenceLevel: Math.max(1, Math.min(10, Math.round(validation.tradeHealthScore / 10))),
    tradePlan: runtimePlan.notes ?? 'AlphaMentals validated trade execution.',
    reasonForEntry: `${runtimePlan.setupGrade} setup validated by AlphaMentals. Health score ${validation.tradeHealthScore}/100.`,
    entryTime: new Date().toISOString(),
    isRevengeTrade: false,
    isFomo: false,
  });

  let response: ExecuteTradeResponse = {
    success: true,
    allowed: true,
    status: 'EXECUTED',
    tradeId: String((journal as { id?: string }).id ?? ''),
    journalId: String((journal as { id?: string }).id ?? ''),
    metaApiOrderId: metaApiResponse.orderId,
    blockingReasons: [],
    warnings: validation.warnings,
    validation,
    message: live
      ? 'Trade executed successfully and journal entry created.'
      : 'Paper trade validated and journal entry created.',
  };
  const logId = await writeAccountabilityLog({
    plan: runtimePlan,
    validation,
    status: 'EXECUTED',
    executionAttempted: live,
    metaApiResponse,
    journalId: response.journalId,
    response,
  });
  response = { ...response, accountabilityLogId: logId };
  await updateAccountabilityResponse(logId, response);
  completedResponses.set(plan.idempotencyKey, response);
  return response;
}
