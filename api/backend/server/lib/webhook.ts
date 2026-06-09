// Backend-only n8n / generic webhook sender. Never throws; returns a result
// so a missing or broken webhook can never crash the app.

export interface WebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function isValidWebhookUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function sendWebhook(
  url: string,
  secret: string | undefined,
  payload: unknown,
): Promise<WebhookResult> {
  if (!isValidWebhookUrl(url)) {
    return { ok: false, error: 'Invalid webhook URL' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Webhook-Secret'] = secret;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Webhook responded ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown webhook error';
    console.error('[webhook] send failed:', message);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
