"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatComplete = chatComplete;
exports.chatCompleteJSON = chatCompleteJSON;
const diag = __importStar(require("./aiDiagnostics.js"));
const ledger_js_1 = require("./cost/ledger.js");
const pricing_js_1 = require("./cost/pricing.js");
const openaiConfig_js_1 = require("./openaiConfig.js");
function getConfig() {
    const apiKey = (0, openaiConfig_js_1.getConfiguredOpenAIApiKey)();
    const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey)
        throw new Error('OPENAI_API_KEY must be set');
    return { apiKey, baseUrl };
}
const DEFAULT_MODEL = (0, openaiConfig_js_1.getOpenAIModel)();
function extractTextContent(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('');
    }
    return '';
}
async function chatComplete(messages, options = {}) {
    if (diag.isCoolingDown()) {
        const msLeft = diag.msUntilNextSlot();
        throw new Error(`AI rate limit cooldown active — retry in ${Math.ceil(msLeft / 1000)}s`);
    }
    const { apiKey, baseUrl } = getConfig();
    const { maxTokens = 512, temperature = 0.1 } = options;
    const modelName = options.model ?? DEFAULT_MODEL;
    const startMs = Date.now();
    const timeoutMs = (0, openaiConfig_js_1.getPairAiTimeoutMs)();
    (0, openaiConfig_js_1.logOpenAIConfiguration)();
    try {
        const body = {
            model: modelName,
            messages,
            temperature,
            max_tokens: maxTokens,
        };
        if (options.jsonMode)
            body.response_format = { type: 'json_object' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException(`timeout after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
        let res;
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
        }
        finally {
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
        const json = JSON.parse(text);
        const content = extractTextContent(json.choices[0]?.message?.content);
        const usage = json.usage;
        const durationMs = Date.now() - startMs;
        diag.recordRequest(options.symbols ?? [], durationMs);
        const promptTokens = usage?.prompt_tokens ?? 0;
        const completionTokens = usage?.completion_tokens ?? 0;
        const { inputCostUsd, outputCostUsd, totalCostUsd } = (0, pricing_js_1.calculateCost)('openai', modelName, promptTokens, completionTokens);
        (0, ledger_js_1.recordCost)({
            provider: 'openai',
            service: 'ai',
            model: modelName,
            feature: options.feature ?? 'unknown',
            operation: options.operation ?? 'chat_complete',
            status: 'success',
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
    }
    catch (err) {
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
async function chatCompleteJSON(messages, options) {
    const response = await chatComplete(messages, { ...options, jsonMode: true });
    const match = /\{[\s\S]*\}/.exec(response.content);
    if (!match) {
        const retry = await chatComplete(messages, { ...options, jsonMode: false });
        const retryMatch = /\{[\s\S]*\}/.exec(retry.content);
        if (!retryMatch)
            throw new Error('No JSON object in model response after retry');
        return JSON.parse(retryMatch[0]);
    }
    return JSON.parse(match[0]);
}
