export interface RiskConfig {
  maxRiskPerTradePercent?: number;
  dailyLossLimitPercent?: number;
  maxOpenTrades?: number;
  allowedSymbols?: string[];
  requireConfirmationBeforeTrade?: boolean;
}

export interface RiskValidationResult {
  valid: boolean;
  errors: string[];
  normalized: Required<RiskConfig>;
}

export function validateRiskConfig(risk: RiskConfig | undefined, tradingEnabled: boolean): RiskValidationResult {
  const errors: string[] = [];
  const r = risk ?? {};

  const maxRiskPerTradePercent = r.maxRiskPerTradePercent ?? 1;
  const dailyLossLimitPercent = r.dailyLossLimitPercent ?? 3;
  const maxOpenTrades = r.maxOpenTrades ?? 3;
  const allowedSymbols = r.allowedSymbols ?? [];
  const requireConfirmationBeforeTrade = r.requireConfirmationBeforeTrade ?? true;

  if (maxRiskPerTradePercent < 0.1 || maxRiskPerTradePercent > 5) {
    errors.push('maxRiskPerTradePercent must be between 0.1 and 5');
  }
  if (dailyLossLimitPercent < 0.5 || dailyLossLimitPercent > 20) {
    errors.push('dailyLossLimitPercent must be between 0.5 and 20');
  }
  if (maxOpenTrades < 1 || maxOpenTrades > 20 || !Number.isInteger(maxOpenTrades)) {
    errors.push('maxOpenTrades must be an integer between 1 and 20');
  }
  if (tradingEnabled && allowedSymbols.length === 0) {
    errors.push('allowedSymbols is required when tradingEnabled is true');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      maxRiskPerTradePercent,
      dailyLossLimitPercent,
      maxOpenTrades,
      allowedSymbols,
      requireConfirmationBeforeTrade,
    },
  };
}
