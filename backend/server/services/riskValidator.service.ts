export interface TradeRiskInput {
  entryPrice: number;
  stopLoss: number | null | undefined;
  takeProfit: number | null | undefined;
  lotSize: number | null | undefined;
}

export interface RiskValidationResult {
  isValid: boolean;
  warnings: string[];
  blockers: string[];
}

export function validateTradeRisk(input: TradeRiskInput): RiskValidationResult {
  const { entryPrice, stopLoss, takeProfit, lotSize } = input;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (stopLoss == null || stopLoss === entryPrice) {
    blockers.push('MISSING_STOP_LOSS');
  }

  if (takeProfit == null || takeProfit === entryPrice) {
    warnings.push('MISSING_TAKE_PROFIT');
  }

  if (lotSize == null || lotSize === 0) {
    blockers.push('LOT_SIZE_ZERO');
  }

  const hasValidSL = stopLoss != null && stopLoss !== entryPrice;
  const hasValidTP = takeProfit != null && takeProfit !== entryPrice;

  if (hasValidSL && hasValidTP) {
    const slDistance = Math.abs(entryPrice - (stopLoss as number));
    const tpDistance = Math.abs((takeProfit as number) - entryPrice);
    const actualRR = tpDistance / slDistance;

    if (actualRR < 1.0) {
      warnings.push('POOR_RR');
    }
  }

  return {
    isValid: blockers.length === 0,
    warnings,
    blockers,
  };
}
