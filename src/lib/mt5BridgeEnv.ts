export function resolveMt5BridgeBaseUrl(): string | null {
  return process.env.MT5_BRIDGE_URL?.trim() || null;
}

export function resolveMt5BridgeApiKey(): string | null {
  return process.env.MT5_BRIDGE_API_KEY?.trim() || null;
}

export function getMt5BridgeAuthDiagnostics(urlOrEndpoint?: string | null) {
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
