/**
 * Centralized API pricing configuration.
 *
 * Prices should be verified against provider pricing pages before production use.
 * Override any price via the corresponding environment variable.
 *
 * OpenAI:  https://openai.com/pricing
 */

export interface ModelPricing {
  provider: string;
  model: string;
  /** Cost per 1,000,000 input (prompt) tokens in USD */
  inputPer1M: number;
  /** Cost per 1,000,000 output (completion) tokens in USD */
  outputPer1M: number;
}

// gpt-4o-mini — verify at https://openai.com/pricing
const DEFAULT_INPUT_PER_1M  = 0.150;   // $0.150 / 1M input tokens
const DEFAULT_OUTPUT_PER_1M = 0.600;   // $0.600 / 1M output tokens

const OPENAI_MODELS: ModelPricing[] = [
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputPer1M:  Number(process.env.OPENAI_PRICING_INPUT_PER_1M  ?? DEFAULT_INPUT_PER_1M),
    outputPer1M: Number(process.env.OPENAI_PRICING_OUTPUT_PER_1M ?? DEFAULT_OUTPUT_PER_1M),
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    inputPer1M:  5.00,
    outputPer1M: 15.00,
  },
  // Anthropic Claude (used by aiCoach)
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    inputPer1M:  0.80,
    outputPer1M: 4.00,
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputPer1M:  3.00,
    outputPer1M: 15.00,
  },
];

/** Look up pricing for a given provider + model. Returns undefined if not found. */
export function getModelPricing(provider: string, model: string): ModelPricing | undefined {
  const key = model.toLowerCase();
  const providerKey = provider.toLowerCase();

  // Exact match first
  const exact = OPENAI_MODELS.find(
    (p) => p.provider === providerKey && p.model === key,
  );
  if (exact) return exact;

  // Prefix match (handles versioned model names like gpt-4o-mini-2024-07-18)
  return OPENAI_MODELS.find(
    (p) => p.provider === providerKey && key.startsWith(p.model),
  );
}

/** Calculate USD cost from token counts. Returns 0 if pricing is not found. */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } {
  const pricing = getModelPricing(provider, model);
  if (!pricing) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }
  const inputCostUsd  = (promptTokens     / 1_000_000) * pricing.inputPer1M;
  const outputCostUsd = (completionTokens / 1_000_000) * pricing.outputPer1M;
  return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
}

/** Monthly fixed cost from env var, or null if not configured. */
export function getMonthlyFixedCost(envVar: string): number | null {
  const raw = process.env[envVar];
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
