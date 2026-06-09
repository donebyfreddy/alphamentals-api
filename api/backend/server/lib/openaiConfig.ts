const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_PAIR_AI_TIMEOUT_MS = 60_000;

function firstNonEmpty(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function getConfiguredOpenAIApiKey(): string | null {
  return firstNonEmpty([process.env.OPENAI_API_KEY, process.env.OPEN_AI_KEY]);
}

export function isOpenAIConfigured(): boolean {
  return Boolean(getConfiguredOpenAIApiKey());
}

export function getOpenAIModel(): string {
  return firstNonEmpty([process.env.OPENAI_MODEL]) ?? DEFAULT_OPENAI_MODEL;
}

export function getPairAiTimeoutMs(): number {
  const raw = firstNonEmpty([process.env.PAIR_AI_TIMEOUT_MS, process.env.OPENAI_TIMEOUT_MS]);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= DEFAULT_PAIR_AI_TIMEOUT_MS) return parsed;
  return DEFAULT_PAIR_AI_TIMEOUT_MS;
}

let startupLogged = false;

export function logOpenAIConfiguration(): void {
  if (startupLogged) return;
  startupLogged = true;
  console.log('[openai] OPENAI_API_KEY configured:', isOpenAIConfigured());
}
