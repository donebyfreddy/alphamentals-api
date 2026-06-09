"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguredOpenAIApiKey = getConfiguredOpenAIApiKey;
exports.isOpenAIConfigured = isOpenAIConfigured;
exports.getOpenAIModel = getOpenAIModel;
exports.getPairAiTimeoutMs = getPairAiTimeoutMs;
exports.logOpenAIConfiguration = logOpenAIConfiguration;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_PAIR_AI_TIMEOUT_MS = 60_000;
function firstNonEmpty(values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return null;
}
function getConfiguredOpenAIApiKey() {
    return firstNonEmpty([process.env.OPENAI_API_KEY, process.env.OPEN_AI_KEY]);
}
function isOpenAIConfigured() {
    return Boolean(getConfiguredOpenAIApiKey());
}
function getOpenAIModel() {
    return firstNonEmpty([process.env.OPENAI_MODEL]) ?? DEFAULT_OPENAI_MODEL;
}
function getPairAiTimeoutMs() {
    const raw = firstNonEmpty([process.env.PAIR_AI_TIMEOUT_MS, process.env.OPENAI_TIMEOUT_MS]);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= DEFAULT_PAIR_AI_TIMEOUT_MS)
        return parsed;
    return DEFAULT_PAIR_AI_TIMEOUT_MS;
}
let startupLogged = false;
function logOpenAIConfiguration() {
    if (startupLogged)
        return;
    startupLogged = true;
    console.log('[openai] OPENAI_API_KEY configured:', isOpenAIConfigured());
}
