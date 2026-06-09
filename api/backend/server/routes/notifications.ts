import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getPreferences, savePreferences, listNotifications, markRead, markAllRead, clearHistory,
  sendTestEmail, sendTestWebhook, createNotification, NOTIFICATION_CATEGORIES,
} from '../services/notification.service.js';
import { isEmailConfigured, getMailMode } from '../lib/mailer.js';
import { sendDailyFundamentalEventsEmail, sendWeeklyFundamentalEventsEmail } from '../services/fundamentalEventNotifications.service.js';

export const notificationsRouter = Router();

function userId(): string {
  return process.env.DEFAULT_USER_ID ?? '';
}

const SEVERITIES = ['info', 'warning', 'critical'] as const;

const PreferencesSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  dailyFundamentalEventsEmail: z.boolean().optional(),
  weeklyFundamentalEventsEmail: z.boolean().optional(),
  emailRecipient: z.string().email().nullable().or(z.literal('')).optional(),
  emailCc: z.string().email().nullable().or(z.literal('')).optional(),
  emailSenderName: z.string().max(120).optional(),
  emailFrequency: z.enum(['instant', 'daily', 'weekly']).optional(),
  emailMinSeverity: z.enum(SEVERITIES).optional(),
  enabledEmailCategories: z.array(z.string()).optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().url().nullable().or(z.literal('')).optional(),
  webhookSecret: z.string().max(500).nullable().or(z.literal('')).optional(),
  enabledWebhookCategories: z.array(z.string()).optional(),
});

// GET /api/notifications/config — server-side capability (no secrets)
notificationsRouter.get('/config', (_req: Request, res: Response) => {
  const mode = getMailMode();
  res.json({
    emailConfigured: isEmailConfigured(),
    mailMode: mode,
    emailProvider: 'resend',
    resendConfigured: mode === 'resend',
    fromEmailConfigured: Boolean(process.env.RESEND_FROM_EMAIL),
    categories: NOTIFICATION_CATEGORIES,
  });
});

// GET /api/notifications/preferences
notificationsRouter.get('/preferences', async (_req: Request, res: Response) => {
  try {
    res.json(await getPreferences(userId()));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load preferences' });
  }
});

// PUT /api/notifications/preferences  (POST accepted for compatibility)
async function handleSavePreferences(req: Request, res: Response) {
  try {
    const parsed = PreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid preferences', details: parsed.error.flatten() });
      return;
    }
    // Normalise empty strings to null.
    const patch = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [k, v === '' ? null : v]),
    );
    res.json(await savePreferences(userId(), patch));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save preferences' });
  }
}
notificationsRouter.put('/preferences', handleSavePreferences);
notificationsRouter.post('/preferences', handleSavePreferences);

// GET /api/notifications/history
notificationsRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await listNotifications(userId(), limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load history' });
  }
});

// POST /api/notifications/mark-read
notificationsRouter.post('/mark-read', async (req: Request, res: Response) => {
  try {
    const id = (req.body as { id?: string }).id;
    if (!id) { res.status(400).json({ error: 'id is required' }); return; }
    await markRead(userId(), id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// POST /api/notifications/mark-all-read
notificationsRouter.post('/mark-all-read', async (_req: Request, res: Response) => {
  try {
    await markAllRead(userId());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// POST /api/notifications/clear-history
notificationsRouter.post('/clear-history', async (_req: Request, res: Response) => {
  try {
    await clearHistory(userId());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// POST /api/notifications/test-email
notificationsRouter.post('/test-email', async (req: Request, res: Response) => {
  const recipient = (req.body as { recipient?: string }).recipient;
  const result = await sendTestEmail(userId(), recipient);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /api/notifications/test-webhook
notificationsRouter.post('/test-webhook', async (req: Request, res: Response) => {
  const { url, secret } = (req.body as { url?: string; secret?: string });
  const result = await sendTestWebhook(userId(), url, secret);
  res.status(result.success ? 200 : 400).json(result);
});

notificationsRouter.post('/fundamental-events/send-daily', async (req: Request, res: Response) => {
  try {
    const result = await sendDailyFundamentalEventsEmail(Boolean(req.body?.force));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send daily fundamental events email' });
  }
});

notificationsRouter.post('/fundamental-events/send-weekly', async (req: Request, res: Response) => {
  try {
    const result = await sendWeeklyFundamentalEventsEmail(Boolean(req.body?.force));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send weekly fundamental events email' });
  }
});

// POST /api/notifications  — create a notification (internal / manual testing)
notificationsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const result = await createNotification({ ...req.body, userId: userId() });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});
