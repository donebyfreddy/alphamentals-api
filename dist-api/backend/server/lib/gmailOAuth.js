"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGmailPublicStatus = getGmailPublicStatus;
exports.saveGmailConfig = saveGmailConfig;
exports.generateAuthUrl = generateAuthUrl;
exports.exchangeCodeForTokens = exchangeCodeForTokens;
exports.disconnectGmail = disconnectGmail;
exports.loadGmailConfigIntoEnv = loadGmailConfigIntoEnv;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const CONFIG_PATH = node_path_1.default.join(__dirname, '../data/gmail-config.json');
/** Derives the OAuth2 redirect URI from env vars or falls back to the standard callback path. */
function deriveRedirectUri() {
    if (process.env.GMAIL_REDIRECT_URI)
        return process.env.GMAIL_REDIRECT_URI;
    const baseUrl = (process.env.APP_URL
        ?? process.env.NEXT_PUBLIC_APP_URL
        ?? process.env.NEXT_PUBLIC_API_URL
        ?? process.env.API_URL
        ?? process.env.BACKEND_URL
        ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/+$/, '');
    if (!baseUrl)
        return '/api/gmail/callback';
    return `${baseUrl}/api/gmail/callback`;
}
function readConfigFile() {
    try {
        const raw = node_fs_1.default.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function writeConfigFile(config) {
    node_fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}
function getGmailPublicStatus() {
    const cfg = readConfigFile();
    const clientId = process.env.GOOGLE_CLIENT_ID || cfg.clientId || '';
    const hasClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET || cfg.clientSecret);
    const googleConfigured = Boolean(clientId && hasClientSecret);
    const senderEmail = cfg.senderEmail || process.env.GMAIL_SENDER_EMAIL || '';
    const hasRefreshToken = Boolean(cfg.refreshToken || process.env.GOOGLE_REFRESH_TOKEN);
    const connectedEmail = cfg.connectedEmail;
    const connectedAt = cfg.connectedAt;
    const redirectUri = deriveRedirectUri();
    let status = 'not_configured';
    if (clientId && hasClientSecret && senderEmail) {
        status = hasRefreshToken ? 'connected' : 'configured';
    }
    if (cfg.error)
        status = 'error';
    return { status, googleConfigured, redirectUri, senderEmail, connectedEmail, connectedAt, hasClientSecret, hasRefreshToken, error: cfg.error };
}
function saveGmailConfig(input) {
    const existing = readConfigFile();
    const updated = {
        ...existing,
        senderEmail: input.senderEmail,
        error: undefined,
    };
    writeConfigFile(updated);
    syncEnvFromConfig(updated);
}
function generateAuthUrl() {
    const cfg = readConfigFile();
    const clientId = process.env.GOOGLE_CLIENT_ID || cfg.clientId || '';
    const redirectUri = deriveRedirectUri();
    if (!clientId)
        throw new Error('Gmail Client ID is required');
    const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'email',
        'profile',
    ].join(' ');
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
async function exchangeCodeForTokens(code) {
    const cfg = readConfigFile();
    const clientId = cfg.clientId || process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = cfg.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = deriveRedirectUri();
    if (!clientId || !clientSecret) {
        throw new Error('Gmail OAuth2 credentials are not configured');
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }).toString(),
    });
    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Token exchange failed: ${err}`);
    }
    const tokens = (await tokenRes.json());
    if (tokens.error || !tokens.refresh_token) {
        throw new Error(tokens.error ?? 'No refresh token returned — ensure prompt=consent was used');
    }
    // Get connected user email
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = (await userRes.json());
    const updated = {
        ...cfg,
        refreshToken: tokens.refresh_token,
        connectedEmail: userInfo.email ?? cfg.senderEmail ?? '',
        connectedAt: new Date().toISOString(),
        error: undefined,
    };
    writeConfigFile(updated);
    syncEnvFromConfig(updated);
    return { email: userInfo.email ?? '' };
}
function disconnectGmail() {
    const cfg = readConfigFile();
    const updated = {
        ...cfg,
        refreshToken: undefined,
        connectedEmail: undefined,
        connectedAt: undefined,
        error: undefined,
    };
    writeConfigFile(updated);
    // Clear runtime env vars for tokens
    delete process.env.GOOGLE_REFRESH_TOKEN;
}
/** Call at server startup to populate process.env from the config file if env vars are absent. */
function loadGmailConfigIntoEnv() {
    const cfg = readConfigFile();
    syncEnvFromConfig(cfg);
}
function syncEnvFromConfig(cfg) {
    if (cfg.clientId)
        process.env.GOOGLE_CLIENT_ID = cfg.clientId;
    if (cfg.clientSecret)
        process.env.GOOGLE_CLIENT_SECRET = cfg.clientSecret;
    if (cfg.senderEmail)
        process.env.GMAIL_SENDER_EMAIL = cfg.senderEmail;
    if (cfg.refreshToken)
        process.env.GOOGLE_REFRESH_TOKEN = cfg.refreshToken;
}
