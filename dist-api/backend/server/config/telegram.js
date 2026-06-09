"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTelegramEnvConfig = getTelegramEnvConfig;
exports.getTelegramStartupValidationMessage = getTelegramStartupValidationMessage;
const node_fs_1 = __importDefault(require("node:fs"));
function clean(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
function getTelegramEnvConfig() {
    const apiId = clean(process.env.TELEGRAM_API_ID);
    const apiHash = clean(process.env.TELEGRAM_API_HASH);
    const envSession = clean(process.env.TELEGRAM_SESSION_STRING) ?? clean(process.env.TELEGRAM_SESSION);
    const sessionFile = clean(process.env.TELEGRAM_SESSION_FILE);
    const sessionName = clean(process.env.TELEGRAM_SESSION_NAME) ?? (process.env.NODE_ENV === 'production' ? 'telegram_prod' : 'telegram_local');
    const targetChat = clean(process.env.TELEGRAM_TARGET_CHAT);
    let session = envSession;
    let sessionSource = envSession ? 'env' : null;
    if (!session && sessionFile) {
        try {
            if (!node_fs_1.default.existsSync(sessionFile)) {
                return {
                    apiId,
                    apiHash,
                    session: null,
                    sessionFile,
                    sessionName,
                    sessionSource: 'file',
                    targetChat,
                    enabled: true,
                    configured: false,
                    missing: [],
                    error: `TELEGRAM_SESSION_FILE does not exist: ${sessionFile}.`,
                };
            }
            session = clean(node_fs_1.default.readFileSync(sessionFile, 'utf8'));
            sessionSource = session ? 'file' : null;
            if (!session) {
                return {
                    apiId,
                    apiHash,
                    session: null,
                    sessionFile,
                    sessionName,
                    sessionSource: 'file',
                    targetChat,
                    enabled: true,
                    configured: false,
                    missing: [],
                    error: `TELEGRAM_SESSION_FILE is empty: ${sessionFile}.`,
                };
            }
        }
        catch (error) {
            return {
                apiId,
                apiHash,
                session: null,
                sessionFile,
                sessionName,
                sessionSource: 'file',
                targetChat,
                enabled: true,
                configured: false,
                missing: [],
                error: `Failed to read TELEGRAM_SESSION_FILE: ${error instanceof Error ? error.message : String(error)}.`,
            };
        }
    }
    const values = {
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
        TELEGRAM_SESSION: session,
        TELEGRAM_TARGET_CHAT: targetChat,
    };
    const enabled = Object.values(values).some(Boolean);
    const missing = Object.entries(values)
        .filter(([, value]) => !value)
        .map(([key]) => key);
    if (!enabled) {
        return {
            apiId,
            apiHash,
            session,
            sessionFile,
            sessionName,
            sessionSource,
            targetChat,
            enabled: false,
            configured: false,
            missing: [],
            error: null,
        };
    }
    if (missing.length) {
        return {
            apiId,
            apiHash,
            session,
            sessionFile,
            sessionName,
            sessionSource,
            targetChat,
            enabled: true,
            configured: false,
            missing,
            error: `Telegram is partially configured. Missing: ${missing.join(', ')}.`,
        };
    }
    if (!/^\d+$/.test(apiId ?? '')) {
        return {
            apiId,
            apiHash,
            session,
            sessionFile,
            sessionName,
            sessionSource,
            targetChat,
            enabled: true,
            configured: false,
            missing: [],
            error: 'TELEGRAM_API_ID must be numeric.',
        };
    }
    return {
        apiId,
        apiHash,
        session,
        sessionFile,
        sessionName,
        sessionSource,
        targetChat,
        enabled: true,
        configured: true,
        missing: [],
        error: null,
    };
}
function getTelegramStartupValidationMessage() {
    const config = getTelegramEnvConfig();
    return config.error;
}
