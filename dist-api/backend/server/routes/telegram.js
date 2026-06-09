"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const telegramInfo_service_js_1 = require("../services/telegramInfo.service.js");
const telegramSignalAnalyze_service_js_1 = require("../services/telegramSignalAnalyze.service.js");
const telegramBridge_service_js_1 = require("../services/telegramBridge.service.js");
const telegramAutoSignal_service_js_1 = require("../services/telegramAutoSignal.service.js");
const mailer_js_1 = require("../lib/mailer.js");
const telegramMessageStore_service_js_1 = require("../services/telegramMessageStore.service.js");
exports.telegramRouter = (0, express_1.Router)();
const SyncSchema = zod_1.z.object({
    limit: zod_1.z.number().int().min(1).max(100).optional(),
});
function isAuthorizedCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret)
        return false;
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const headerSecret = req.headers['x-cron-secret'] ?? '';
    return bearer === secret || headerSecret === secret;
}
function emptyDiagnostic() {
    return {
        enabled: true,
        configured: false,
        targetChatConfigured: false,
        connected: false,
        loggedIn: false,
        targetChatAccessible: false,
        targetChatResolved: false,
        canReadMessages: false,
        messagesFetched: 0,
        currentPhase: null,
        account: null,
        targetChat: null,
        targetChatTitle: null,
        targetChatType: null,
        lastMessageDate: null,
        lastSyncAt: null,
        error: null,
        lastError: null,
        errorCode: null,
        errorPhase: null,
        errorMessage: null,
        stack: null,
        hints: [],
        status: 'not_configured',
    };
}
exports.telegramRouter.get('/status', async (_req, res) => {
    try {
        const status = await (0, telegramInfo_service_js_1.getTelegramStatus)();
        res.json(status);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        res.status(normalized.status).json({
            ...emptyDiagnostic(),
            error: normalized.message,
            errorCode: 'TELEGRAM_UNAVAILABLE',
        });
    }
});
exports.telegramRouter.get('/diagnostics', async (_req, res) => {
    try {
        const status = await (0, telegramInfo_service_js_1.getTelegramStatus)();
        res.json({
            configured: status.configured,
            connected: status.connected,
            loggedIn: status.loggedIn,
            account: status.account?.username ? `@${status.account.username}` : status.account?.displayName ?? null,
            targetChat: status.targetChat,
            targetChatConfigured: status.targetChatConfigured,
            resolvedChat: status.targetChatResolved ? status.targetChat : null,
            targetChatResolved: status.targetChatResolved,
            resolvedChatTitle: status.targetChatTitle ?? null,
            resolvedChatType: status.targetChatType ?? null,
            canReadMessages: status.canReadMessages,
            readTestPassed: status.canReadMessages,
            messagesFetched: status.messagesFetched,
            lastMessageDate: status.lastMessageDate,
            currentPhase: status.currentPhase,
            lastError: status.lastError,
            errorPhase: status.errorPhase,
            errorMessage: status.errorMessage,
            errorCode: status.errorCode,
            stack: status.stack,
            hints: status.hints,
            status: status.status,
        });
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        res.status(normalized.status).json({
            connected: false,
            loggedIn: false,
            configured: false,
            account: null,
            targetChat: null,
            targetChatConfigured: false,
            resolvedChat: null,
            targetChatResolved: false,
            resolvedChatTitle: null,
            resolvedChatType: null,
            canReadMessages: false,
            readTestPassed: false,
            messagesFetched: 0,
            lastMessageDate: null,
            currentPhase: normalized.phase ?? null,
            lastError: normalized.message,
            errorPhase: normalized.phase ?? null,
            errorMessage: normalized.message,
            errorCode: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
            stack: normalized.stack ?? null,
            hints: normalized.hints ?? [],
            status: 'not_configured',
        });
    }
});
exports.telegramRouter.get('/debug', async (_req, res) => {
    try {
        const result = await (0, telegramBridge_service_js_1.runTelegramDoctor)();
        res.json({
            backend_alive: true,
            python_found: result.python_found,
            python_version: result.python_version,
            python_executable: result.python_executable,
            script_exists: result.script_exists,
            script_path: result.script_path,
            env_vars_present: result.env_vars,
            telethon_installed: result.doctor?.telethon_installed ?? false,
            dotenv_installed: result.doctor?.dotenv_loaded ?? false,
            session_configured: result.doctor?.session_configured ?? false,
            session_source: result.doctor?.session_source ?? null,
            session_error: result.doctor?.session_error ?? null,
            api_id_configured: result.doctor?.api_id_configured ?? false,
            api_hash_configured: result.doctor?.api_hash_configured ?? false,
            target_chat_configured: result.doctor?.target_chat_configured ?? false,
            working_directory: result.doctor?.working_directory ?? null,
            error_code: result.error_code,
            doctor_error: result.doctor_error,
            raw_stderr: result.raw_stderr,
        });
    }
    catch (error) {
        res.status(500).json({
            backend_alive: true,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
exports.telegramRouter.get('/test-connection', async (_req, res) => {
    try {
        const result = await (0, telegramInfo_service_js_1.getTelegramConnectionTest)();
        const statusCode = result.error
            ? result.code === 'MISSING_CREDENTIALS' || result.code === 'INVALID_TARGET_CHAT'
                ? 400
                : result.code === 'INVALID_API_CREDENTIALS' || result.code === 'INVALID_SESSION'
                    ? 401
                    : result.code === 'TARGET_CHAT_ACCESS_DENIED'
                        ? 403
                        : result.code === 'TELEGRAM_RATE_LIMIT'
                            ? 429
                            : 503
            : 200;
        res.status(statusCode).json(result);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        res.status(normalized.status).json({
            enabled: true,
            connected: false,
            loggedIn: false,
            targetChatAccessible: false,
            targetChatResolved: false,
            canReadMessages: false,
            messagesFetched: 0,
            currentPhase: normalized.phase ?? null,
            lastMessageDate: null,
            account: null,
            targetChat: null,
            error: normalized.message,
            code: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
            errorPhase: normalized.phase ?? null,
            errorMessage: normalized.message,
            stack: normalized.stack ?? null,
            hints: normalized.hints ?? [],
        });
    }
});
exports.telegramRouter.post('/sync', async (req, res) => {
    try {
        const parsed = SyncSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid sync payload.', details: parsed.error.flatten() });
        }
        console.log('[Telegram] /api/telegram/sync request received', {
            phase: 'frontend_request',
            operation: 'sync',
            limit: parsed.data.limit ?? 10,
        });
        const result = await (0, telegramInfo_service_js_1.syncTelegramMessages)(parsed.data.limit ?? 10);
        console.log('[Telegram] /api/telegram/sync response ready', {
            phase: 'frontend_response',
            operation: 'sync',
            success: result.success,
            messagesFetched: result.messagesFetched ?? 0,
            imported: result.imported,
            skipped: result.skipped,
            errorCount: result.errors.length,
        });
        return res.json(result);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        const accountLabel = normalized.account?.username
            ? `@${normalized.account.username}`
            : normalized.account?.displayName ?? null;
        console.error('[Telegram] Sync request failed:', {
            phase: normalized.phase ?? 'unknown',
            operation: 'sync',
            account: accountLabel,
            targetChat: normalized.targetChat ?? null,
            resolvedChat: normalized.targetChatInfo ?? null,
            messagesFetched: null,
            messagesSaved: 0,
            name: normalized.telegramError ?? 'TelegramSyncError',
            message: normalized.message,
            code: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
            stack: normalized.stack ?? null,
            raw: normalized.rawMessage ?? normalized.details ?? null,
            hints: normalized.hints ?? [],
        });
        return res.status(normalized.status).json({
            success: false,
            phase: normalized.phase ?? 'unknown',
            message: normalized.message,
            imported: 0,
            skipped: 0,
            errors: [normalized.rawMessage ?? normalized.message],
            error: normalized.message,
            errorCode: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
            errorPhase: normalized.phase ?? null,
            httpStatus: normalized.status,
            targetChat: normalized.targetChat ?? null,
            resolvedChat: normalized.targetChatInfo ?? null,
            account: accountLabel,
            telegramError: normalized.telegramError ?? null,
            loginOk: normalized.loginOk ?? false,
            targetChatResolved: normalized.targetChatResolved ?? false,
            canReadMessages: normalized.canReadMessages ?? false,
            details: normalized.details ?? normalized.rawMessage ?? null,
            stack: normalized.stack ?? null,
            hints: normalized.hints ?? [],
        });
    }
});
exports.telegramRouter.post('/cron', async (req, res) => {
    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
    }
    try {
        const parsed = SyncSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid sync payload.', details: parsed.error.flatten() });
        }
        const result = await (0, telegramInfo_service_js_1.syncTelegramSignals)(parsed.data.limit ?? 10, {
            source: 'cron',
            enforceRateLimit: false,
        });
        return res.json(result);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        return res.status(normalized.status).json({
            ok: false,
            checkedChannels: 0,
            newMessages: 0,
            newSignals: 0,
            emailsSent: 0,
            errors: [normalized.message],
            phase: normalized.phase ?? 'unknown',
            errorCode: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
            details: normalized.details ?? normalized.rawMessage ?? null,
            hints: normalized.hints ?? [],
        });
    }
});
exports.telegramRouter.get('/messages/recent', async (req, res) => {
    try {
        const limit = Number(req.query.limit ?? 30);
        const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
        const messageType = typeof req.query.messageType === 'string' ? req.query.messageType : undefined;
        const direction = typeof req.query.direction === 'string' ? req.query.direction : undefined;
        console.log('[Telegram] /api/telegram/messages/recent request received', {
            phase: 'frontend_request',
            operation: 'recent_messages',
            limit: Number.isFinite(limit) ? limit : 30,
            symbol: symbol ?? null,
            messageType: messageType ?? null,
            direction: direction ?? null,
        });
        const messages = await (0, telegramInfo_service_js_1.getRecentTelegramMessages)({
            limit: Number.isFinite(limit) ? limit : 30,
            symbol,
            messageType,
            direction,
        });
        console.log('[Telegram] Returning messages to UI...', {
            phase: 'frontend_response',
            operation: 'recent_messages',
            returned: messages.length,
        });
        console.log(`[Telegram] UI payload size: ${messages.length}`);
        return res.json(messages);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        console.error('[Telegram] Recent messages request failed:', {
            phase: normalized.phase ?? 'frontend_response',
            operation: 'recent_messages',
            message: normalized.message,
            code: normalized.code ?? null,
            stack: normalized.stack ?? null,
        });
        return res.status(normalized.status).json({ error: normalized.message });
    }
});
exports.telegramRouter.post('/messages/:id/analyze', async (req, res) => {
    try {
        const result = await (0, telegramInfo_service_js_1.analyzeTelegramMessage)(req.params.id);
        return res.json(result);
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        return res.status(normalized.status).json({ error: normalized.message });
    }
});
exports.telegramRouter.post('/messages/:id/send-analysis', async (req, res) => {
    try {
        const result = await (0, telegramAutoSignal_service_js_1.sendEmailForMessage)(req.params.id);
        if (!result.sent) {
            return res.status(422).json({ success: false, error: result.error });
        }
        return res.json({
            success: true,
            provider: 'resend',
            verdict: result.verdict,
            confidence: result.confidence,
            emailId: 'emailId' in result ? result.emailId : null,
        });
    }
    catch (error) {
        const normalized = (0, telegramInfo_service_js_1.normalizeTelegramRouteError)(error);
        return res.status(normalized.status).json({ success: false, error: normalized.message });
    }
});
// GET /api/telegram/email-diagnostics — Resend connection status and recent email history
exports.telegramRouter.get('/email-diagnostics', async (_req, res) => {
    const emailConfigured = (0, mailer_js_1.isEmailConfigured)();
    const mailMode = (0, mailer_js_1.getMailMode)();
    const fromEmail = (0, mailer_js_1.getSenderEmail)();
    let lastEmailSent = null;
    let lastEmailFailed = null;
    const queue = [];
    try {
        const recent = await (0, telegramMessageStore_service_js_1.listRecentTelegramMessages)({ limit: 50 });
        for (const msg of recent) {
            const { emailStatus, emailSentAt, emailError, autoAnalysisAt } = msg;
            if (emailStatus === 'sent' && emailSentAt && !lastEmailSent) {
                lastEmailSent = { at: emailSentAt, symbol: msg.symbol ?? null, emailId: null };
            }
            if (emailStatus === 'failed' && !lastEmailFailed) {
                lastEmailFailed = { at: autoAnalysisAt ?? '', symbol: msg.symbol ?? null, error: emailError ?? null };
            }
            if (emailStatus === 'pending' || emailStatus === 'failed') {
                queue.push({ messageId: msg.id, symbol: msg.symbol ?? null, status: emailStatus });
            }
        }
    }
    catch {
        // diagnostics are best-effort
    }
    return res.json({
        provider: 'resend',
        emailConfigured,
        mailMode,
        fromEmail,
        resendApiKeySet: Boolean(process.env.RESEND_API_KEY),
        lastEmailSent,
        lastEmailFailed,
        queue: queue.slice(0, 10),
    });
});
// POST /api/telegram/test-email — send a test email via Resend and return the emailId
exports.telegramRouter.post('/test-email', async (_req, res) => {
    const recipient = 'fo.mencuccini@gmail.com';
    if (!(0, mailer_js_1.isEmailConfigured)()) {
        return res.status(503).json({
            success: false,
            provider: 'resend',
            message: 'RESEND_API_KEY is not configured on this server.',
        });
    }
    const from = (0, mailer_js_1.getSenderEmail)();
    if (!from) {
        return res.status(503).json({
            success: false,
            provider: 'resend',
            message: 'RESEND_FROM_EMAIL is not configured.',
        });
    }
    console.log('[telegram] Sending test signal email', { provider: 'resend', to: recipient, stage: 'sending' });
    const result = await (0, mailer_js_1.sendMail)({
        to: recipient,
        subject: '✅ AlphaMentals — Resend Test Email',
        html: `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#070b12;color:#e5edf7;border-radius:12px;">
        <h2 style="color:#34d399;margin:0 0 12px;">✅ Resend connection verified</h2>
        <p style="color:#dbe4f0;">This test email confirms that AlphaMentals can deliver Telegram signal emails to <strong>${recipient}</strong> via Resend.</p>
        <p style="margin-top:16px;color:#8ea0b8;font-size:13px;">Provider: <strong>resend</strong> · From: ${from}</p>
      </div>
    `,
        text: `AlphaMentals Resend test email. Delivered to ${recipient} via Resend.`,
        fromName: 'AlphaMentals',
        context: { signal: 'TEST' },
    });
    if (result.ok) {
        console.log('[telegram] Test email sent', { provider: 'resend', emailId: result.emailId ?? null, to: recipient, stage: 'sent' });
        return res.json({
            success: true,
            provider: 'resend',
            emailId: result.emailId ?? null,
            message: 'Test email delivered',
        });
    }
    console.error('[telegram] Test email failed', { provider: 'resend', to: recipient, stage: 'failed', error: result.error });
    return res.status(500).json({
        success: false,
        provider: 'resend',
        message: result.error ?? 'Failed to send test email',
    });
});
const SignalAnalyzeSchema = zod_1.z.object({
    rawText: zod_1.z.string().min(1),
    parsedSignal: zod_1.z
        .object({
        direction: zod_1.z.string().optional(),
        orderType: zod_1.z.string().nullable().optional(),
        entry: zod_1.z.number().nullable().optional(),
        sl: zod_1.z.number().nullable().optional(),
        tps: zod_1.z.array(zod_1.z.number()).optional(),
    })
        .optional(),
});
exports.telegramRouter.post('/signals/analyze', async (req, res) => {
    const parsed = SignalAnalyzeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Invalid request body.', details: parsed.error.flatten() });
    }
    try {
        const { rawText, parsedSignal } = parsed.data;
        const result = await (0, telegramSignalAnalyze_service_js_1.analyzeSignalWithAI)(rawText, parsedSignal);
        return res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Signal analysis failed';
        return res.status(500).json({ ok: false, error: message });
    }
});
