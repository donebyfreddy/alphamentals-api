"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mt5BridgeClient = exports.MT5BridgeClient = exports.MT5BridgeHttpError = void 0;
const mt5BridgeEnv_js_1 = require("../../../src/lib/mt5BridgeEnv.js");
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
class MT5BridgeHttpError extends Error {
    endpoint;
    status;
    responseBody;
    constructor(params) {
        super(params.message);
        this.name = 'MT5BridgeHttpError';
        this.endpoint = params.endpoint;
        this.status = params.status;
        this.responseBody = params.responseBody;
    }
}
exports.MT5BridgeHttpError = MT5BridgeHttpError;
class MT5BridgeClient {
    baseUrl;
    apiKey;
    timeoutMs;
    retryAttempts;
    constructor() {
        this.baseUrl = (0, mt5BridgeEnv_js_1.resolveMt5BridgeBaseUrl)() || null;
        this.apiKey = (0, mt5BridgeEnv_js_1.resolveMt5BridgeApiKey)() || null;
        this.timeoutMs = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
        this.retryAttempts = Number(process.env.MT5_BRIDGE_RETRY_ATTEMPTS ?? DEFAULT_RETRY_ATTEMPTS);
    }
    isConfigured() {
        return Boolean(this.baseUrl && this.apiKey);
    }
    getConfigSummary() {
        return {
            configured: this.isConfigured(),
            baseUrl: this.baseUrl,
            timeoutMs: this.timeoutMs,
            retryAttempts: this.retryAttempts,
            usesHeader: 'x-api-key',
            auth: (0, mt5BridgeEnv_js_1.getMt5BridgeAuthDiagnostics)(this.baseUrl),
        };
    }
    async get(path, init = {}) {
        return this.request(path, { ...init, method: 'GET' });
    }
    async post(path, body, init = {}) {
        return this.request(path, {
            ...init,
            method: 'POST',
            body: body === undefined ? init.body : JSON.stringify(body),
        });
    }
    async request(path, init = {}) {
        if (!this.baseUrl || !this.apiKey) {
            throw new Error('MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY.');
        }
        const endpoint = `${this.baseUrl}${path}`;
        console.info('[api-proxy] auth_config', (0, mt5BridgeEnv_js_1.getMt5BridgeAuthDiagnostics)(endpoint));
        let lastError = null;
        for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const response = await fetch(endpoint, {
                    ...init,
                    signal: controller.signal,
                    headers: {
                        'x-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                        ...init.headers,
                    },
                });
                const bodyText = await response.text();
                if (!response.ok) {
                    const error = this.buildHttpError(path, response.status, bodyText);
                    this.logFailure(path, response.status, bodyText, attempt);
                    if (attempt < this.retryAttempts && RETRYABLE_STATUS_CODES.has(response.status)) {
                        lastError = error;
                        await this.waitBeforeRetry(attempt);
                        continue;
                    }
                    throw error;
                }
                if (!bodyText)
                    return {};
                return JSON.parse(bodyText);
            }
            catch (error) {
                const normalizedError = this.normalizeTransportError(path, error);
                const isRetryable = this.isRetryableTransportError(normalizedError);
                this.logFailure(path, null, normalizedError.message, attempt);
                if (attempt < this.retryAttempts && isRetryable) {
                    lastError = normalizedError;
                    await this.waitBeforeRetry(attempt);
                    continue;
                }
                throw normalizedError;
            }
            finally {
                clearTimeout(timeout);
            }
        }
        throw lastError ?? new Error(`MT5 bridge request failed for ${path}.`);
    }
    buildHttpError(path, status, responseBody) {
        const suffix = responseBody ? ` Response: ${responseBody}` : '';
        if (status === 401) {
            return new MT5BridgeHttpError({
                endpoint: path,
                status,
                responseBody,
                message: `MT5 bridge unauthorized for ${path}. Check MT5_BRIDGE_API_KEY.${suffix}`,
            });
        }
        if (status === 403) {
            return new MT5BridgeHttpError({
                endpoint: path,
                status,
                responseBody,
                message: `MT5 bridge forbidden for ${path}. Access was denied.${suffix}`,
            });
        }
        if (status === 404) {
            return new MT5BridgeHttpError({
                endpoint: path,
                status,
                responseBody,
                message: `MT5 bridge endpoint not found for ${path}.${suffix}`,
            });
        }
        if (status >= 500) {
            return new MT5BridgeHttpError({
                endpoint: path,
                status,
                responseBody,
                message: `MT5 bridge server error for ${path} (HTTP ${status}).${suffix}`,
            });
        }
        return new MT5BridgeHttpError({
            endpoint: path,
            status,
            responseBody,
            message: `MT5 bridge request failed for ${path} (HTTP ${status}).${suffix}`,
        });
    }
    normalizeTransportError(path, error) {
        if (error instanceof MT5BridgeHttpError)
            return error;
        if (error instanceof Error && error.name === 'AbortError') {
            return new Error(`MT5 bridge request timed out for ${path} after ${this.timeoutMs}ms.`);
        }
        if (error instanceof Error) {
            return new Error(`MT5 bridge network failure for ${path}: ${error.message}`);
        }
        return new Error(`MT5 bridge network failure for ${path}.`);
    }
    isRetryableTransportError(error) {
        return !(error instanceof MT5BridgeHttpError);
    }
    async waitBeforeRetry(attempt) {
        const delayMs = Math.min(250 * 2 ** (attempt - 1), 2_000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    logFailure(path, status, body, attempt) {
        const statusLabel = status == null ? 'NETWORK_ERROR' : String(status);
        console.error('[mt5-bridge-client] request failed', {
            endpoint: path,
            status: statusLabel,
            attempt,
            responseBody: body,
        });
    }
}
exports.MT5BridgeClient = MT5BridgeClient;
exports.mt5BridgeClient = new MT5BridgeClient();
