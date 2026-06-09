import { supabase } from '../lib/supabase.js';
import { sendMail, isEmailConfigured, getMailMode } from '../lib/mailer.js';
import { sendWebhook, isValidWebhookUrl } from '../lib/webhook.js';

// ── Taxonomy ─────────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'economic_calendar'
  | 'market_intelligence'
  | 'high_impact_news'
  | 'fundamentals'
  | 'telegram_signals'
  | 'account_sync'
  | 'journal_trade'
  | 'dashboard_alert'
  | 'risk_management'
  | 'ai_coach'
  | 'system_error';

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type DeliveryStatus = 'sent' | 'failed' | 'skipped' | 'disabled';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'economic_calendar', 'market_intelligence', 'high_impact_news', 'fundamentals', 'telegram_signals',
  'account_sync', 'journal_trade', 'dashboard_alert', 'risk_management', 'ai_coach', 'system_error',
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  economic_calendar: 'Economic Calendar',
  market_intelligence: 'Market Intelligence',
  high_impact_news: 'High-Impact News',
  fundamentals: 'Fundamentals',
  telegram_signals: 'Telegram Signals',
  account_sync: 'Account Sync',
  journal_trade: 'Journal / Trade',
  dashboard_alert: 'Dashboard Alert',
  risk_management: 'Risk Management',
  ai_coach: 'AI Coach',
  system_error: 'System Error',
};

const SEVERITY_RANK: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 };

// ── Preferences ──────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  userId: string;
  notificationsEnabled: boolean;
  emailEnabled: boolean;
  dailyFundamentalEventsEmail: boolean;
  weeklyFundamentalEventsEmail: boolean;
  emailRecipient: string | null;
  emailCc: string | null;
  emailSenderName: string;
  emailFrequency: 'instant' | 'daily' | 'weekly';
  emailMinSeverity: NotificationSeverity;
  enabledEmailCategories: string[];
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  enabledWebhookCategories: string[];
  updatedAt?: string;
}

function defaultPreferences(userId: string): NotificationPreferences {
  return {
    userId,
    notificationsEnabled: true,
    emailEnabled: false,
    dailyFundamentalEventsEmail: true,
    weeklyFundamentalEventsEmail: true,
    emailRecipient: null,
    emailCc: null,
    emailSenderName: 'AlphaMentals',
    emailFrequency: 'instant',
    emailMinSeverity: 'warning',
    enabledEmailCategories: [...NOTIFICATION_CATEGORIES],
    webhookEnabled: false,
    webhookUrl: null,
    webhookSecret: null,
    enabledWebhookCategories: [...NOTIFICATION_CATEGORIES],
  };
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  try {
    const { data } = await supabase
      .from('notification_preferences').select('*').eq('userId', userId).maybeSingle();
    if (!data) return defaultPreferences(userId);
    return { ...defaultPreferences(userId), ...(data as Partial<NotificationPreferences>), userId };
  } catch {
    return defaultPreferences(userId);
  }
}

const EDITABLE_PREF_KEYS: (keyof NotificationPreferences)[] = [
  'notificationsEnabled', 'emailEnabled', 'dailyFundamentalEventsEmail', 'weeklyFundamentalEventsEmail', 'emailRecipient', 'emailCc', 'emailSenderName',
  'emailFrequency', 'emailMinSeverity', 'enabledEmailCategories', 'webhookEnabled',
  'webhookUrl', 'webhookSecret', 'enabledWebhookCategories',
];

export async function savePreferences(userId: string, patch: Partial<NotificationPreferences>) {
  const payload: Record<string, unknown> = { userId, updatedAt: new Date().toISOString() };
  for (const key of EDITABLE_PREF_KEYS) {
    if (patch[key] !== undefined) payload[key] = patch[key];
  }
  const { data, error } = await supabase
    .from('notification_preferences').upsert(payload, { onConflict: 'userId' }).select().single();
  if (error) throw new Error(error.message);
  return { ...defaultPreferences(userId), ...(data as Partial<NotificationPreferences>), userId };
}

// ── Email content ────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444',
};

export function buildEmailSubject(category: NotificationCategory, severity: NotificationSeverity, title: string): string {
  const sev = severity === 'critical' ? 'Critical ' : '';
  return `[AlphaMentals] ${sev}${title}`.slice(0, 180);
}

function metadataRows(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  const rows = Object.entries(metadata)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#9ca3af;">${k}</td><td style="padding:2px 0;">${String(v)}</td></tr>`)
    .join('');
  if (!rows) return '';
  return `<table style="font-size:13px;margin-top:8px;border-collapse:collapse;">${rows}</table>`;
}

export interface EmailContext {
  title: string;
  message: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  symbol?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export function buildEmailHtml(ctx: EmailContext): string {
  const color = SEVERITY_COLOR[ctx.severity];
  const when = new Date(ctx.createdAt).toUTCString();
  const linkBtn = ctx.link
    ? `<a href="${ctx.link}" style="display:inline-block;margin-top:16px;padding:10px 16px;background:#7c6af7;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;">Open in AlphaMentals</a>`
    : '';
  const symbolRow = ctx.symbol ? `<span style="margin-left:8px;color:#9ca3af;">· ${ctx.symbol}</span>` : '';
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0f1117;color:#e5e7eb;border-radius:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="color:#7c6af7;margin:0;font-size:18px;">AlphaMentals</h2>
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${color};border:1px solid ${color};padding:3px 8px;border-radius:999px;">${ctx.severity}</span>
      </div>
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin:0 0 4px;">${CATEGORY_LABELS[ctx.category]}${symbolRow}</p>
      <h3 style="margin:0 0 10px;font-size:16px;color:#f3f4f6;">${ctx.title}</h3>
      <p style="margin:0;line-height:1.5;color:#d1d5db;">${ctx.message}</p>
      ${metadataRows(ctx.metadata)}
      ${linkBtn}
      <p style="color:#6b7280;font-size:12px;margin:20px 0 0;border-top:1px solid #1f2937;padding-top:12px;">${when} · Sent by AlphaMentals notifications</p>
    </div>`;
}

// ── Core: createNotification ─────────────────────────────────────────────────

export interface CreateNotificationInput {
  userId?: string;
  title: string;
  message: string;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  source?: string;
  symbol?: string;
  link?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

function resolveUserId(userId?: string): string {
  return userId || process.env.DEFAULT_USER_ID || '';
}

/**
 * Central entry point for every dashboard alert. Stores an in-app notification,
 * then (respecting preferences) delivers via email and/or n8n webhook, recording
 * per-channel delivery status. NEVER throws — a delivery failure is logged and
 * stored, it never crashes the caller.
 */
export async function createNotification(input: CreateNotificationInput) {
  const userId = resolveUserId(input.userId);
  const severity: NotificationSeverity = input.severity ?? 'info';
  try {
    const prefs = await getPreferences(userId);
    if (!prefs.notificationsEnabled) return null;

    // De-duplicate: skip if an unread notification with the same key exists recently.
    if (input.dedupeKey) {
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: dupes } = await supabase
        .from('notifications').select('id')
        .eq('userId', userId).eq('dedupeKey', input.dedupeKey).eq('read', false)
        .gte('createdAt', since).limit(1);
      if (dupes && dupes.length > 0) return null;
    }

    // Evaluate delivery eligibility.
    const meetsSeverity = SEVERITY_RANK[severity] >= SEVERITY_RANK[prefs.emailMinSeverity];
    const emailEligible =
      prefs.emailEnabled && !!prefs.emailRecipient && meetsSeverity &&
      prefs.emailFrequency === 'instant' && prefs.enabledEmailCategories.includes(input.category);
    const webhookEligible =
      prefs.webhookEnabled && isValidWebhookUrl(prefs.webhookUrl) &&
      prefs.enabledWebhookCategories.includes(input.category);

    const createdAt = new Date().toISOString();

    // Persist the in-app record first so it always exists, even if delivery fails.
    const { data: row, error } = await supabase.from('notifications').insert({
      userId, title: input.title, message: input.message, category: input.category,
      severity, source: input.source ?? null, symbol: input.symbol ?? null,
      link: input.link ?? null, metadata: input.metadata ?? {},
      dedupeKey: input.dedupeKey ?? null,
      emailStatus: emailEligible ? 'skipped' : (prefs.emailEnabled ? 'skipped' : 'disabled'),
      webhookStatus: webhookEligible ? 'skipped' : (prefs.webhookEnabled ? 'skipped' : 'disabled'),
      createdAt,
    }).select().single();
    if (error) throw new Error(error.message);

    let emailStatus: DeliveryStatus = emailEligible ? 'skipped' : (prefs.emailEnabled ? 'skipped' : 'disabled');
    let emailError: string | undefined;
    let webhookStatus: DeliveryStatus = webhookEligible ? 'skipped' : (prefs.webhookEnabled ? 'skipped' : 'disabled');
    let webhookError: string | undefined;

    // Email delivery
    if (emailEligible) {
      const html = buildEmailHtml({ ...input, severity, createdAt });
      const result = await sendMail({
        to: prefs.emailRecipient as string,
        cc: prefs.emailCc ?? undefined,
        subject: buildEmailSubject(input.category, severity, input.title),
        html,
        text: input.message,
        fromName: prefs.emailSenderName,
      });
      emailStatus = result.ok ? 'sent' : 'failed';
      emailError = result.ok ? undefined : result.error;
    }

    // Webhook delivery
    if (webhookEligible) {
      const result = await sendWebhook(prefs.webhookUrl as string, prefs.webhookSecret ?? undefined, {
        app: 'AlphaMentals',
        title: input.title, message: input.message, category: input.category, severity,
        source: input.source ?? input.category, symbol: input.symbol ?? null,
        link: input.link ?? null, metadata: input.metadata ?? {}, createdAt,
      });
      webhookStatus = result.ok ? 'sent' : 'failed';
      webhookError = result.ok ? undefined : result.error;
    }

    if (emailEligible || webhookEligible) {
      await supabase.from('notifications').update({
        emailStatus, emailError: emailError ?? null,
        webhookStatus, webhookError: webhookError ?? null,
      }).eq('id', (row as { id: string }).id);
    }

    return { ...(row as Record<string, unknown>), emailStatus, webhookStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown notification error';
    console.error('[notifications] createNotification failed:', message);
    return null;
  }
}

// ── History ──────────────────────────────────────────────────────────────────

export async function listNotifications(userId: string, limit = 50) {
  const { data, error } = await supabase
    .from('notifications').select('*').eq('userId', userId)
    .order('createdAt', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markRead(userId: string, id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id).eq('userId', userId);
  if (error) throw new Error(error.message);
}

export async function markAllRead(userId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('userId', userId).eq('read', false);
  if (error) throw new Error(error.message);
}

export async function clearHistory(userId: string) {
  const { error } = await supabase.from('notifications').delete().eq('userId', userId);
  if (error) throw new Error(error.message);
}

// ── Test actions ─────────────────────────────────────────────────────────────

const DEFAULT_ALERT_RECIPIENT = 'fo.mencuccini@gmail.com';

export async function sendTestEmail(userId: string, recipientOverride?: string) {
  const prefs = await getPreferences(userId);
  const recipient = recipientOverride || prefs.emailRecipient || DEFAULT_ALERT_RECIPIENT;
  if (!isEmailConfigured()) {
    return { success: false, provider: 'resend', message: 'Email is not configured on the server. Set RESEND_API_KEY.' };
  }
  const createdAt = new Date().toISOString();
  console.log('[notification] Sending test email', { provider: 'resend', to: recipient, stage: 'sending' });
  const result = await sendMail({
    to: recipient,
    cc: prefs.emailCc ?? undefined,
    subject: buildEmailSubject('dashboard_alert', 'info', 'Test Notification'),
    html: buildEmailHtml({
      title: 'Test Notification',
      message: 'Your AlphaMentals email notifications are configured correctly.',
      category: 'dashboard_alert', severity: 'info', createdAt,
      metadata: { mode: getMailMode(), provider: 'resend' },
    }),
    text: 'Your AlphaMentals email notifications are configured correctly.',
    fromName: prefs.emailSenderName,
    context: { signal: 'TEST' },
  });
  if (result.ok) {
    console.log('[notification] Test email sent', { provider: 'resend', emailId: result.emailId ?? null, to: recipient, stage: 'sent' });
    return {
      success: true,
      provider: 'resend',
      emailId: result.emailId ?? null,
      message: `Test email delivered to ${recipient}.`,
    };
  }
  console.error('[notification] Test email failed', { provider: 'resend', to: recipient, stage: 'failed', error: result.error });
  return { success: false, provider: 'resend', message: result.error ?? 'Failed to send test email.' };
}

export async function sendTestWebhook(userId: string, urlOverride?: string, secretOverride?: string) {
  const prefs = await getPreferences(userId);
  const url = urlOverride || prefs.webhookUrl;
  const secret = secretOverride ?? prefs.webhookSecret ?? undefined;
  if (!isValidWebhookUrl(url)) return { success: false, message: 'No valid webhook URL set.' };
  const result = await sendWebhook(url, secret, {
    app: 'AlphaMentals',
    title: 'Test Webhook',
    message: 'Your AlphaMentals n8n webhook is configured correctly.',
    category: 'dashboard_alert', severity: 'info', source: 'test',
    symbol: null, metadata: { test: true }, createdAt: new Date().toISOString(),
  });
  return result.ok
    ? { success: true, message: 'Test webhook delivered successfully.' }
    : { success: false, message: result.error ?? 'Failed to deliver test webhook.' };
}
