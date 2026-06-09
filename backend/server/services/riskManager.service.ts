export interface RiskCalcInput {
  accountSize: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  instrument: 'forex' | 'gold' | 'indices';
  lotSize?: number; // standard lot = 100000 units
}

export interface RiskCalcResult {
  dollarRisk: number;
  lotSize: number;
  units: number;
  pipValue: number;
  pips: number;
  rrRatio: number;
  dollarTarget: number;
  breakEvenPercent: number;
  suggestion: string;
}

const PIP_VALUES: Record<string, number> = {
  forex: 10,    // per standard lot per pip (USD pairs)
  gold: 1,      // XAUUSD: $1 per 0.01 lot per $1 move
  indices: 1,
};

export function calculateRisk(input: RiskCalcInput): RiskCalcResult {
  const { accountSize, riskPercent, entryPrice, stopLoss, takeProfit, instrument } = input;

  const dollarRisk = (accountSize * riskPercent) / 100;
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - entryPrice);
  const rrRatio = tpDistance / slDistance;

  let lotSize: number;
  let pipValue: number;
  let pips: number;

  if (instrument === 'forex') {
    // pip = 0.0001 for 4-decimal pairs, 0.01 for JPY pairs
    const pipSize = entryPrice > 50 ? 0.01 : 0.0001;
    pips = slDistance / pipSize;
    pipValue = 10; // $10/pip for 1 standard lot on USD pairs
    lotSize = dollarRisk / (pips * pipValue);
  } else if (instrument === 'gold') {
    // XAUUSD: $1 = 1 point. 1 standard lot = 100 oz
    pips = slDistance;
    pipValue = 100; // $100 per $1 move per standard lot
    lotSize = dollarRisk / (slDistance * pipValue);
  } else {
    pips = slDistance;
    pipValue = 1;
    lotSize = dollarRisk / slDistance;
  }

  const units = lotSize * 100000;
  const dollarTarget = dollarRisk * rrRatio;

  let suggestion = '';
  if (rrRatio < 1) suggestion = 'WARNING: RR below 1:1 — this trade does not meet minimum standards.';
  else if (rrRatio < 2) suggestion = 'Acceptable RR. Consider if the setup justifies a sub-2R trade.';
  else if (rrRatio >= 3) suggestion = 'Excellent RR. Ensure entry is precise — wide stops dilute quality.';
  else suggestion = 'Good RR. Risk is well-defined.';

  if (riskPercent > 2) suggestion += ' CAUTION: Risk exceeds 2% per trade recommendation.';

  return {
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    lotSize: Math.round(lotSize * 100) / 100,
    units: Math.round(units),
    pipValue,
    pips: Math.round(pips * 10) / 10,
    rrRatio: Math.round(rrRatio * 100) / 100,
    dollarTarget: Math.round(dollarTarget * 100) / 100,
    breakEvenPercent: Math.round((1 / (rrRatio + 1)) * 1000) / 10,
    suggestion,
  };
}
