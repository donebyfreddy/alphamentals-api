import { incrementResend } from './cost/counters.js';
import { recordCost } from './cost/ledger.js';

// Sends email via Resend REST API (not SMTP).
// Required env vars:
//   RESEND_API_KEY    — Resend API key (re_...)
//   RESEND_FROM_EMAIL — verified sender address, e.g. alerts@yourdomain.com

export type MailMode = 'resend' | 'none';

export interface SendMailInput {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  context?: {
    signal?: string;
    messageId?: string;
  };
}

export interface SendMailResult {
  ok: boolean;
  mode: MailMode;
  emailId?: string;
  error?: string;
}

export function hasResend(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function hasFromEmail(): boolean {
  return Boolean(process.env.RESEND_FROM_EMAIL);
}

export function getMailMode(): MailMode {
  return hasResend() ? 'resend' : 'none';
}

export function isEmailConfigured(): boolean {
  return hasResend();
}

export function getSenderEmail(): string | null {
  return process.env.RESEND_FROM_EMAIL ?? null;
}

const RESEND_API_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [0, 5_000, 15_000, 45_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMailOnce(input: SendMailInput, fromEmail: string, apiKey: string): Promise<SendMailResult> {
  const fromName = input.fromName ?? process.env.RESEND_FROM_NAME ?? 'AlphaMentals';
  const logCtx = {
    provider: 'resend',
    signal: input.context?.signal ?? null,
    messageId: input.context?.messageId ?? null,
    to: input.to,
  };

  console.log('[mailer] Sending email', { ...logCtx, stage: 'sending' });

  const body: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.cc) body.cc = [input.cc];
  if (input.text) body.text = input.text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
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

  const rawText = await response.text().catch(() => '');

  if (!response.ok) {
    let detail = rawText;
    try {
      const parsed = JSON.parse(rawText) as { message?: string; name?: string };
      detail = parsed.message ?? parsed.name ?? rawText;
    } catch {
      // leave detail as raw text
    }
    const error = `HTTP ${response.status}: ${detail}`;
    console.error('[mailer] Resend API failed', { ...logCtx, stage: 'failed', status: response.status, error });
    return { ok: false, mode: 'resend', error };
  }

  let emailId: string | undefined;
  try {
    const data = JSON.parse(rawText) as { id?: string };
    emailId = data.id;
  } catch {
    // id is optional
  }

  console.log('[mailer] Email sent', { ...logCtx, stage: 'sent', emailId: emailId ?? null });
  return { ok: true, mode: 'resend', emailId };
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[mailer] RESEND_API_KEY is not set');
    return { ok: false, mode: 'none', error: 'Email is not configured. Set RESEND_API_KEY.' };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    console.error('[mailer] RESEND_FROM_EMAIL is not set');
    return { ok: false, mode: 'resend', error: 'RESEND_FROM_EMAIL is not set. Add a verified sender address.' };
  }

  let lastResult: SendMailResult = { ok: false, mode: 'resend', error: 'Not attempted' };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      console.log(`[mailer] Retry ${attempt}/${RETRY_DELAYS_MS.length - 1} in ${delay}ms`, {
        provider: 'resend',
        signal: input.context?.signal ?? null,
        attempt,
      });
      await sleep(delay);
    }

    try {
      lastResult = await sendMailOnce(input, fromEmail, apiKey);
      if (lastResult.ok) {
        incrementResend(false);
        recordCost({ provider: 'resend', service: 'email', feature: 'notifications', operation: 'send_email', status: 'success' });
        return lastResult;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastResult = { ok: false, mode: 'resend', error: message };
      console.error(`[mailer] Send attempt ${attempt + 1} threw:`, {
        provider: 'resend',
        signal: input.context?.signal ?? null,
        stage: 'failed',
        error: message,
      });
    }
  }

  incrementResend(true);
  recordCost({
    provider: 'resend',
    service: 'email',
    feature: 'notifications',
    operation: 'send_email',
    status: 'failed',
    metadata: { error: lastResult.error },
  });

  console.error('[mailer] All send attempts exhausted', {
    provider: 'resend',
    signal: input.context?.signal ?? null,
    stage: 'failed',
    error: lastResult.error,
    attempts: RETRY_DELAYS_MS.length,
  });

  return lastResult;
}
