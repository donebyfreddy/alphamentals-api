"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMt5BridgeBaseUrl = resolveMt5BridgeBaseUrl;
exports.resolveMt5BridgeApiKey = resolveMt5BridgeApiKey;
exports.getMt5BridgeAuthDiagnostics = getMt5BridgeAuthDiagnostics;
function resolveMt5BridgeBaseUrl() {
    return process.env.MT5_BRIDGE_URL?.trim() || null;
}
function resolveMt5BridgeApiKey() {
    return process.env.MT5_BRIDGE_API_KEY?.trim() || null;
}
function getMt5BridgeAuthDiagnostics(urlOrEndpoint) {
    const baseUrl = resolveMt5BridgeBaseUrl();
    const apiKey = resolveMt5BridgeApiKey();
    return {
        baseUrlConfigured: Boolean(baseUrl),
        apiKeyConfigured: Boolean(apiKey),
        baseUrl: baseUrl ?? null,
        endpoint: urlOrEndpoint ?? null,
        authHeader: 'x-api-key',
    };
}
