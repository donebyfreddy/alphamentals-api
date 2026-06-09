"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const notification_service_js_1 = require("../services/notification.service.js");
const mailer_js_1 = require("../lib/mailer.js");
const fundamentalEventNotifications_service_js_1 = require("../services/fundamentalEventNotifications.service.js");
exports.notificationsRouter = (0, express_1.Router)();
function userId() {
    return process.env.DEFAULT_USER_ID ?? '';
}
const SEVERITIES = ['info', 'warning', 'critical'];
const PreferencesSchema = zod_1.z.object({
    notificationsEnabled: zod_1.z.boolean().optional(),
    emailEnabled: zod_1.z.boolean().optional(),
    dailyFundamentalEventsEmail: zod_1.z.boolean().optional(),
    weeklyFundamentalEventsEmail: zod_1.z.boolean().optional(),
    emailRecipient: zod_1.z.string().email().nullable().or(zod_1.z.literal('')).optional(),
    emailCc: zod_1.z.string().email().nullable().or(zod_1.z.literal('')).optional(),
    emailSenderName: zod_1.z.string().max(120).optional(),
    emailFrequency: zod_1.z.enum(['instant', 'daily', 'weekly']).optional(),
    emailMinSeverity: zod_1.z.enum(SEVERITIES).optional(),
    enabledEmailCategories: zod_1.z.array(zod_1.z.string()).optional(),
    webhookEnabled: zod_1.z.boolean().optional(),
    webhookUrl: zod_1.z.string().url().nullable().or(zod_1.z.literal('')).optional(),
    webhookSecret: zod_1.z.string().max(500).nullable().or(zod_1.z.literal('')).optional(),
    enabledWebhookCategories: zod_1.z.array(zod_1.z.string()).optional(),
});
// GET /api/notifications/config — server-side capability (no secrets)
exports.notificationsRouter.get('/config', (_req, res) => {
    const mode = (0, mailer_js_1.getMailMode)();
    res.json({
        emailConfigured: (0, mailer_js_1.isEmailConfigured)(),
        mailMode: mode,
        emailProvider: 'resend',
        resendConfigured: mode === 'resend',
        fromEmailConfigured: Boolean(process.env.RESEND_FROM_EMAIL),
        categories: notification_service_js_1.NOTIFICATION_CATEGORIES,
    });
});
// GET /api/notifications/preferences
exports.notificationsRouter.get('/preferences', async (_req, res) => {
    try {
        res.json(await (0, notification_service_js_1.getPreferences)(userId()));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load preferences' });
    }
});
// PUT /api/notifications/preferences  (POST accepted for compatibility)
async function handleSavePreferences(req, res) {
    try {
        const parsed = PreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid preferences', details: parsed.error.flatten() });
            return;
        }
        // Normalise empty strings to null.
        const patch = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === '' ? null : v]));
        res.json(await (0, notification_service_js_1.savePreferences)(userId(), patch));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save preferences' });
    }
}
exports.notificationsRouter.put('/preferences', handleSavePreferences);
exports.notificationsRouter.post('/preferences', handleSavePreferences);
// GET /api/notifications/history
exports.notificationsRouter.get('/history', async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        res.json(await (0, notification_service_js_1.listNotifications)(userId(), limit));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load history' });
    }
});
// POST /api/notifications/mark-read
exports.notificationsRouter.post('/mark-read', async (req, res) => {
    try {
        const id = req.body.id;
        if (!id) {
            res.status(400).json({ error: 'id is required' });
            return;
        }
        await (0, notification_service_js_1.markRead)(userId(), id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// POST /api/notifications/mark-all-read
exports.notificationsRouter.post('/mark-all-read', async (_req, res) => {
    try {
        await (0, notification_service_js_1.markAllRead)(userId());
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// POST /api/notifications/clear-history
exports.notificationsRouter.post('/clear-history', async (_req, res) => {
    try {
        await (0, notification_service_js_1.clearHistory)(userId());
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// POST /api/notifications/test-email
exports.notificationsRouter.post('/test-email', async (req, res) => {
    const recipient = req.body.recipient;
    const result = await (0, notification_service_js_1.sendTestEmail)(userId(), recipient);
    res.status(result.success ? 200 : 400).json(result);
});
// POST /api/notifications/test-webhook
exports.notificationsRouter.post('/test-webhook', async (req, res) => {
    const { url, secret } = req.body;
    const result = await (0, notification_service_js_1.sendTestWebhook)(userId(), url, secret);
    res.status(result.success ? 200 : 400).json(result);
});
exports.notificationsRouter.post('/fundamental-events/send-daily', async (req, res) => {
    try {
        const result = await (0, fundamentalEventNotifications_service_js_1.sendDailyFundamentalEventsEmail)(Boolean(req.body?.force));
        res.status(result.ok ? 200 : 400).json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send daily fundamental events email' });
    }
});
exports.notificationsRouter.post('/fundamental-events/send-weekly', async (req, res) => {
    try {
        const result = await (0, fundamentalEventNotifications_service_js_1.sendWeeklyFundamentalEventsEmail)(Boolean(req.body?.force));
        res.status(result.ok ? 200 : 400).json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send weekly fundamental events email' });
    }
});
// POST /api/notifications  — create a notification (internal / manual testing)
exports.notificationsRouter.post('/', async (req, res) => {
    try {
        const result = await (0, notification_service_js_1.createNotification)({ ...req.body, userId: userId() });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
