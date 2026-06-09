"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatComplete = chatComplete;
exports.chatCompleteJSON = chatCompleteJSON;
function getConfig() {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview';
    if (!apiKey || !endpoint) {
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be set');
    }
    return { apiKey, endpoint, deployment, apiVersion };
}
async function chatComplete(messages, options = {}) {
    const { apiKey, endpoint, deployment, apiVersion } = getConfig();
    const { maxTokens = 512, temperature = 0.1, jsonMode = true } = options;
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const body = {
        messages,
        max_tokens: maxTokens,
        temperature,
    };
    if (jsonMode)
        body.response_format = { type: 'json_object' };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok)
        throw new Error(`Azure OpenAI ${res.status}: ${text}`);
    const json = JSON.parse(text);
    return {
        content: json.choices[0].message.content,
        usage: {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
        },
    };
}
async function chatCompleteJSON(messages, options) {
    const response = await chatComplete(messages, { ...options, jsonMode: true });
    const match = response.content.match(/\{[\s\S]*\}/);
    if (!match) {
        // Retry once
        const retry = await chatComplete(messages, { ...options, jsonMode: true });
        const retryMatch = retry.content.match(/\{[\s\S]*\}/);
        if (!retryMatch)
            throw new Error('No JSON object in Azure OpenAI response after retry');
        return JSON.parse(retryMatch[0]);
    }
    return JSON.parse(match[0]);
}
