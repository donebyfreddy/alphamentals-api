"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailRouter = void 0;
const express_1 = require("express");
const gmailOAuth_js_1 = require("../lib/gmailOAuth.js");
const mailer_js_1 = require("../lib/mailer.js");
exports.gmailRouter = (0, express_1.Router)();
// GET /api/gmail/status
exports.gmailRouter.get('/status', (_req, res) => {
    try {
        res.json((0, gmailOAuth_js_1.getGmailPublicStatus)());
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get Gmail status' });
    }
});
// POST /api/gmail/config  — save sender email only; credentials come from GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars.
exports.gmailRouter.post('/config', (req, res) => {
    try {
        const { senderEmail } = req.body;
        if (!senderEmail?.trim()) {
            res.status(400).json({ error: 'Sender email is missing' });
            return;
        }
        const status = (0, gmailOAuth_js_1.getGmailPublicStatus)();
        if (!status.googleConfigured) {
            res.status(400).json({ error: 'Google OAuth credentials are missing. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables.' });
            return;
        }
        (0, gmailOAuth_js_1.saveGmailConfig)({ senderEmail: senderEmail.trim() });
        res.json({ ok: true, status: (0, gmailOAuth_js_1.getGmailPublicStatus)() });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save Gmail config' });
    }
});
// GET /api/gmail/auth-url  — return the Google OAuth2 authorization URL
exports.gmailRouter.get('/auth-url', (_req, res) => {
    try {
        const url = (0, gmailOAuth_js_1.generateAuthUrl)();
        res.json({ url });
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate auth URL' });
    }
});
// GET /api/gmail/callback  — OAuth2 redirect target from Google
exports.gmailRouter.get('/callback', async (req, res) => {
    const { code, error: oauthError } = req.query;
    const frontendBase = process.env.NEXTJS_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const redirectTo = `${frontendBase}/notifications`;
    if (oauthError || !code) {
        res.redirect(`${redirectTo}?gmail_error=${encodeURIComponent(oauthError ?? 'No authorization code received')}`);
        return;
    }
    try {
        const { email } = await (0, gmailOAuth_js_1.exchangeCodeForTokens)(code);
        res.redirect(`${redirectTo}?gmail_connected=${encodeURIComponent(email)}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'OAuth2 exchange failed';
        res.redirect(`${redirectTo}?gmail_error=${encodeURIComponent(msg)}`);
    }
});
// POST /api/gmail/disconnect
exports.gmailRouter.post('/disconnect', (_req, res) => {
    try {
        (0, gmailOAuth_js_1.disconnectGmail)();
        res.json({ ok: true, status: (0, gmailOAuth_js_1.getGmailPublicStatus)() });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect Gmail' });
    }
});
// POST /api/gmail/test-email
exports.gmailRouter.post('/test-email', async (req, res) => {
    const { recipient } = req.body;
    if (!recipient?.trim()) {
        res.status(400).json({ success: false, message: 'Recipient email is required for test' });
        return;
    }
    const status = (0, gmailOAuth_js_1.getGmailPublicStatus)();
    if (status.status === 'not_configured') {
        res.status(400).json({ success: false, message: 'Gmail Client ID is missing or not configured' });
        return;
    }
    if (status.status === 'configured') {
        res.status(400).json({ success: false, message: 'Google account is not connected — click Connect Google Account first' });
        return;
    }
    if (!status.hasRefreshToken) {
        res.status(400).json({ success: false, message: 'Refresh token missing — reconnect Gmail' });
        return;
    }
    const result = await (0, mailer_js_1.sendMail)({
        to: recipient.trim(),
        subject: '✅ AlphaMentals — Gmail OAuth2 test email',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:8px">
      <h2 style="color:#38bdf8;margin:0 0 12px">AlphaMentals</h2>
      <p>Gmail OAuth2 is working correctly.</p>
      <p style="color:#94a3b8;font-size:13px">Sent from: ${status.senderEmail ?? 'unknown'}</p>
      ${status.connectedEmail ? `<p style="color:#94a3b8;font-size:13px">Connected as: ${status.connectedEmail}</p>` : ''}
    </div>`,
        text: 'Gmail OAuth2 test email from AlphaMentals — it is working correctly.',
        fromName: 'AlphaMentals',
    });
    res.status(result.ok ? 200 : 400).json({
        success: result.ok,
        message: result.ok ? 'Test email sent successfully' : (result.error ?? 'Failed to send test email'),
    });
});
