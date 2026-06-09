import * as diag from './aiDiagnostics.js';
import { recordCost } from './cost/ledger.js';
import { calculateCost } from './cost/pricing.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel, getPairAiTimeoutMs, logOpenAIConfiguration } from './openaiConfig.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /** Override the OpenAI model for this specific call. Defaults to OPENAI_MODEL env or gpt-4o-mini. */
  model?: string;
  /** Symbols this call covers — used for diagnostics. */
  symbols?: string[];
  /** Feature label for cost ledger (e.g. fundamentals, pair_intelligence, telegram, journal). */
  feature?: string;
  /** Operation label for cost ledger (e.g. generate_pair_fundamentals, analyze_signal). */
  operation?: string;
}

export interface ChatResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

interface OpenAIChatResponse {
  choices: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function getConfig() {
  const apiKey = getConfiguredOpenAIApiKey();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  return { apiKey, baseUrl };
}

const DEFAULT_MODEL = getOpenAIModel();

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

export async function chatComplete(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
  if (diag.isCoolingDown()) {
    const msLeft = diag.msUntilNextSlot();
    throw new Error(`AI rate limit cooldown active — retry in ${Math.ceil(msLeft / 1000)}s`);
  }

  const { apiKey, baseUrl } = getConfig();
  const { maxTokens = 512, temperature = 0.1 } = options;
  const modelName = options.model ?? DEFAULT_MODEL;
  const startMs = Date.now();
  const timeoutMs = getPairAiTimeoutMs();
  logOpenAIConfiguration();

  try {
    const body: Record<string, unknown> = {
      model: modelName,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (options.jsonMode) body.response_format = { type: 'json_object' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException(`timeout after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after');
      if (res.status === 429) {
        diag.record429(retryAfter ? Number(retryAfter) : undefined);
      }
      throw new Error(`OpenAI ${res.status}: ${text}`);
    }

    const json = JSON.parse(text) as OpenAIChatResponse;
    const content = extractTextContent(json.choices[0]?.message?.content);
    const usage = json.usage;
    const durationMs = Date.now() - startMs;

    diag.recordRequest(options.symbols ?? [], durationMs);

    const promptTokens     = usage?.prompt_tokens     ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const { inputCostUsd, outputCostUsd, totalCostUsd } = calculateCost('openai', modelName, promptTokens, completionTokens);

    recordCost({
      provider: 'openai',
      service:  'ai',
      model:    modelName,
      feature:  options.feature   ?? 'unknown',
      operation: options.operation ?? 'chat_complete',
      status:   'success',
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd,
      metadata: { symbols: options.symbols ?? [], durationMs, estimated: promptTokens === 0 },
    });

    return {
      content,
      usage: { promptTokens, completionTokens },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('429') || message.toLowerCase().includes('rate') || message.toLowerCase().includes('quota')) {
      const retryMatch = /retry[ -]?after[^\d]*(\d+)/i.exec(message);
      const retrySeconds = retryMatch ? Number(retryMatch[1]) : undefined;
      diag.record429(retrySeconds);
    }
    diag.recordError(message);
    throw err;
  }
}

export async function chatCompleteJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T> {
  const response = await chatComplete(messages, { ...options, jsonMode: true });
  const match = /\{[\s\S]*\}/.exec(response.content);
  if (!match) {
    const retry = await chatComplete(messages, { ...options, jsonMode: false });
    const retryMatch = /\{[\s\S]*\}/.exec(retry.content);
    if (!retryMatch) throw new Error('No JSON object in model response after retry');
    return JSON.parse(retryMatch[0]) as T;
  }
  return JSON.parse(match[0]) as T;
}
