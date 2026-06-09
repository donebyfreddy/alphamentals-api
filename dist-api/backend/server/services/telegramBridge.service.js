"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramBridgeError = void 0;
exports.logTelegramStartupDiagnostics = logTelegramStartupDiagnostics;
exports.getTelegramRuntimeState = getTelegramRuntimeState;
exports.testTelegramConnection = testTelegramConnection;
exports.fetchTelegramHistory = fetchTelegramHistory;
exports.startTelegramMonitoring = startTelegramMonitoring;
exports.stopTelegramMonitoring = stopTelegramMonitoring;
exports.runTelegramDoctor = runTelegramDoctor;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = __importDefault(require("node:readline"));
const telegram_js_1 = require("../config/telegram.js");
const TELEGRAM_BRIDGE_SCRIPT = node_path_1.default.join(process.cwd(), 'scripts', 'telegram_bridge.py');
const PYTHON_CANDIDATES = [process.env.TELEGRAM_PYTHON_BIN?.trim(), 'python3', 'python'].filter(Boolean);
let resolvedPythonExecutable = null;
let monitorProcess = null;
let monitorRestartTimer = null;
let intentionalMonitorStop = false;
const runtimeState = {
    enabled: false,
    configured: false,
    connected: false,
    loggedIn: false,
    targetChatAccessible: false,
    targetChat: (0, telegram_js_1.getTelegramEnvConfig)().targetChat,
    targetChatTitle: null,
    targetChatType: null,
    accountUsername: null,
    account: null,
    targetChatResolved: false,
    canReadMessages: false,
    messagesFetched: 0,
    lastMessageDate: null,
    error: null,
    stack: null,
    code: null,
    currentPhase: null,
    errorPhase: null,
    operation: null,
    hints: [],
    lastSyncAt: null,
    lastProcessedMessageId: null,
};
class TelegramBridgeError extends Error {
    code;
    details;
    status;
    phase;
    operation;
    targetChat;
    loginOk;
    targetChatResolved;
    canReadMessages;
    account;
    targetChatInfo;
    hints;
    errorName;
    errorCode;
    stackDetails;
    constructor(code, message, details = null, context = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.status = mapBridgeErrorCodeToHttpStatus(code);
        this.phase = context.phase ?? null;
        this.operation = context.operation ?? null;
        this.targetChat = context.targetChat ?? null;
        this.loginOk = context.loginOk ?? false;
        this.targetChatResolved = context.targetChatResolved ?? false;
        this.canReadMessages = context.canReadMessages ?? false;
        this.account = context.account ?? null;
        this.targetChatInfo = context.targetChatInfo ?? null;
        this.hints = context.hints ?? [];
        this.errorName = context.errorName ?? null;
        this.errorCode = context.errorCode ?? null;
        this.stackDetails = context.stack ?? null;
    }
}
exports.TelegramBridgeError = TelegramBridgeError;
function parseJsonLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
function mapBridgeErrorCodeToHttpStatus(code) {
    if (code === 'MISSING_CREDENTIALS' || code === 'INVALID_API_ID' || code === 'INVALID_TARGET_CHAT')
        return 400;
    if (code === 'INVALID_API_CREDENTIALS' || code === 'INVALID_SESSION')
        return 401;
    if (code === 'TARGET_CHAT_ACCESS_DENIED')
        return 403;
    if (code === 'TELEGRAM_RATE_LIMIT')
        return 429;
    return 503;
}
function toBridgeError(payload, fallbackMessage) {
    return new TelegramBridgeError(payload?.code ?? 'TELEGRAM_UNAVAILABLE', payload?.message ?? fallbackMessage, payload?.details ?? null, payload ?? {});
}
async function tryRunPythonCommand(command, args, timeoutMs) {
    return await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(command, [TELEGRAM_BRIDGE_SCRIPT, ...args], {
            cwd: process.cwd(),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new TelegramBridgeError('TELEGRAM_TIMEOUT', 'Telegram request timed out.'));
        }, timeoutMs);
        child.on('error', (error) => {
            clearTimeout(timeout);
            if (error.code === 'ENOENT') {
                reject(error);
                return;
            }
            reject(new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error.message));
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve({ stdout, stderr, executable: command });
                return;
            }
            const stdoutLines = stdout.trim().split('\n').filter(Boolean);
            const stderrLines = stderr.trim().split('\n').filter(Boolean);
            const payload = parseJsonLine(stdoutLines.at(-1) ?? '') ?? parseJsonLine(stderrLines.at(-1) ?? '');
            reject(toBridgeError(payload, stderr.trim() || stdout.trim() || 'Telegram command failed.'));
        });
    });
}
async function runBridgeCommand(args, timeoutMs = 30_000) {
    const executables = resolvedPythonExecutable ? [resolvedPythonExecutable] : PYTHON_CANDIDATES;
    let lastError = null;
    for (const executable of executables) {
        try {
            const result = await tryRunPythonCommand(executable, args, timeoutMs);
            resolvedPythonExecutable = result.executable;
            const payload = parseJsonLine(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '');
            if (!payload) {
                throw new TelegramBridgeError('TELEGRAM_UNAVAILABLE', result.stderr.trim() || 'Telegram bridge returned invalid JSON.');
            }
            return payload;
        }
        catch (error) {
            lastError = error;
            if (error?.code === 'ENOENT')
                continue;
            throw error;
        }
    }
    if (lastError instanceof Error)
        throw lastError;
    throw new TelegramBridgeError('PYTHON_NOT_FOUND', 'Python was not found. Install Python 3 or set TELEGRAM_PYTHON_BIN.');
}
function applyConnectionFailure(error) {
    runtimeState.connected = false;
    runtimeState.loggedIn = error instanceof TelegramBridgeError ? error.loginOk : false;
    runtimeState.targetChatAccessible = false;
    runtimeState.targetChatResolved = error instanceof TelegramBridgeError ? error.targetChatResolved : false;
    runtimeState.canReadMessages = error instanceof TelegramBridgeError ? error.canReadMessages : false;
    runtimeState.messagesFetched = 0;
    runtimeState.error = error.message;
    runtimeState.stack = error instanceof TelegramBridgeError ? error.stackDetails : error.stack;
    runtimeState.code = error instanceof TelegramBridgeError ? error.code : 'TELEGRAM_UNAVAILABLE';
    runtimeState.currentPhase = error instanceof TelegramBridgeError ? error.phase : null;
    runtimeState.errorPhase = error instanceof TelegramBridgeError ? error.phase : null;
    runtimeState.operation = error instanceof TelegramBridgeError ? error.operation : null;
    runtimeState.hints = error instanceof TelegramBridgeError ? error.hints : [];
    runtimeState.account = error instanceof TelegramBridgeError ? error.account : runtimeState.account;
    runtimeState.accountUsername = error instanceof TelegramBridgeError ? error.account?.username ?? error.account?.displayName ?? runtimeState.accountUsername : runtimeState.accountUsername;
    runtimeState.targetChatTitle = error instanceof TelegramBridgeError ? error.targetChatInfo?.title ?? runtimeState.targetChatTitle : runtimeState.targetChatTitle;
    runtimeState.targetChatType = error instanceof TelegramBridgeError ? error.targetChatInfo?.type ?? runtimeState.targetChatType : runtimeState.targetChatType;
}
function updateBaseState() {
    const config = (0, telegram_js_1.getTelegramEnvConfig)();
    runtimeState.enabled = config.enabled;
    runtimeState.configured = config.configured;
    runtimeState.targetChat = config.targetChat;
    if (config.error) {
        runtimeState.error = config.error;
        runtimeState.stack = null;
        runtimeState.code = 'MISSING_CREDENTIALS';
        runtimeState.currentPhase = 'load_session';
        runtimeState.errorPhase = 'load_session';
        runtimeState.hints = ['Configura TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION o TELEGRAM_SESSION_FILE, y TELEGRAM_TARGET_CHAT.'];
    }
    else if (!config.enabled) {
        runtimeState.error = null;
        runtimeState.stack = null;
        runtimeState.code = null;
        runtimeState.currentPhase = null;
        runtimeState.errorPhase = null;
        runtimeState.hints = [];
    }
}
function logBridgeFailure(prefix, error) {
    const payload = error instanceof TelegramBridgeError
        ? {
            phase: error.phase,
            operation: error.operation,
            targetChat: error.targetChat,
            loginOk: error.loginOk,
            targetChatResolved: error.targetChatResolved,
            canReadMessages: error.canReadMessages,
            account: error.account,
            targetChatInfo: error.targetChatInfo,
            hints: error.hints,
            name: error.errorName ?? error.name,
            message: error.message,
            code: error.code,
            stack: error.stackDetails ?? error.stack,
            details: error.details,
        }
        : {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    console.error(prefix, payload);
}
function maskSession(value) {
    if (!value)
        return null;
    if (value.length <= 10)
        return 'configured';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
async function logTelegramStartupDiagnostics() {
    updateBaseState();
    const config = (0, telegram_js_1.getTelegramEnvConfig)();
    const preferredPython = process.env.TELEGRAM_PYTHON_BIN?.trim() || null;
    console.log('[Telegram] Startup config', {
        enabled: config.enabled,
        configured: config.configured,
        apiIdConfigured: Boolean(config.apiId),
        apiHashConfigured: Boolean(config.apiHash),
        sessionConfigured: Boolean(config.session),
        sessionSource: config.sessionSource,
        sessionFile: config.sessionFile,
        sessionName: config.sessionName,
        targetChatConfigured: Boolean(config.targetChat),
        targetChat: config.targetChat,
        pythonCandidates: PYTHON_CANDIDATES,
        preferredPython,
        workingDirectory: process.cwd(),
        renderService: process.env.RENDER_SERVICE_NAME ?? null,
        renderInstance: process.env.RENDER_INSTANCE_ID ?? null,
        renderUrl: process.env.RENDER_EXTERNAL_URL ?? null,
        sessionPreview: maskSession(config.session),
    });
    try {
        const doctor = await runBridgeCommand(['doctor', '--json']);
        console.log('[Telegram] Python bridge diagnostics', doctor);
    }
    catch (error) {
        const bridgeError = error instanceof TelegramBridgeError
            ? error
            : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error instanceof Error ? error.message : 'Telegram doctor failed.');
        logBridgeFailure('[Telegram] Python bridge diagnostics failed:', bridgeError);
    }
}
function scheduleMonitorRestart(onMessage) {
    if (intentionalMonitorStop || monitorRestartTimer || !runtimeState.configured)
        return;
    monitorRestartTimer = setTimeout(() => {
        monitorRestartTimer = null;
        void startTelegramMonitoring(onMessage);
    }, 5_000);
}
function handleMonitorEvent(event, onMessage) {
    if (event.event === 'status') {
        runtimeState.currentPhase = event.phase ?? null;
        runtimeState.error = null;
        runtimeState.stack = null;
        runtimeState.code = null;
        if (event.stage === 'session_loaded') {
            console.log('[Telegram] Session loaded', {
                source: event.sessionSource ?? 'unknown',
                sessionFile: event.sessionFile ?? null,
            });
            return;
        }
        if (event.stage === 'connecting') {
            console.log('[Telegram] Connecting to Telegram...');
            return;
        }
        if (event.stage === 'logged_in') {
            runtimeState.connected = true;
            runtimeState.loggedIn = event.loginOk ?? true;
            runtimeState.accountUsername = event.username ?? event.displayName ?? null;
            runtimeState.account = event.account ?? null;
            console.log('[Telegram] Logged in successfully');
            if (event.username || event.displayName) {
                console.log(`[Telegram] Account: ${event.username ? `@${event.username}` : event.displayName}`);
            }
            return;
        }
        if (event.stage === 'resolving_target_chat') {
            console.log(`[Telegram] Resolving target chat: ${event.targetChat ?? runtimeState.targetChat ?? 'unknown'}`);
            return;
        }
        if (event.stage === 'target_chat_connected') {
            runtimeState.targetChatAccessible = true;
            runtimeState.targetChatResolved = true;
            runtimeState.targetChat = event.chatId ?? runtimeState.targetChat;
            runtimeState.targetChatTitle = event.chatTitle ?? null;
            runtimeState.targetChatType = event.chatType ?? null;
            console.log(`[Telegram] Target chat resolved: ${event.chatTitle ?? event.chatId ?? 'Unknown chat'}`);
            if (event.chatType) {
                console.log(`[Telegram] Chat type: ${event.chatType}`);
            }
            if (event.chatId) {
                console.log(`[Telegram] Target chat ID: ${event.chatId}`);
            }
            return;
        }
        if (event.stage === 'reading_messages') {
            console.log('[Telegram] Validating channel read access...');
            return;
        }
        if (event.stage === 'message_read_test_ok') {
            runtimeState.canReadMessages = event.canReadMessages ?? true;
            runtimeState.lastMessageDate = event.lastMessageDate ?? null;
            console.log(`[Telegram] Permissions: read_messages=${runtimeState.canReadMessages ? 'true' : 'false'}`);
            console.log('[Telegram] Message read test OK');
            if (event.lastMessageDate) {
                console.log(`[Telegram] Last message date: ${event.lastMessageDate}`);
            }
            return;
        }
        if (event.stage === 'monitoring_enabled') {
            console.log('[Telegram] Read-only ingestion enabled');
        }
        return;
    }
    if (event.event === 'warning') {
        runtimeState.connected = false;
        runtimeState.loggedIn = event.loginOk ?? false;
        runtimeState.targetChatAccessible = false;
        runtimeState.targetChatResolved = event.targetChatResolved ?? false;
        runtimeState.canReadMessages = event.canReadMessages ?? false;
        runtimeState.currentPhase = event.phase ?? null;
        runtimeState.error = event.message ?? 'Telegram monitor warning';
        runtimeState.code = event.code ?? 'TELEGRAM_WARNING';
        runtimeState.errorPhase = event.phase ?? null;
        runtimeState.operation = event.operation ?? null;
        runtimeState.hints = event.hints ?? [];
        console.warn('[Telegram] Warning:', {
            phase: event.phase,
            operation: event.operation,
            targetChat: event.targetChat ?? runtimeState.targetChat,
            message: runtimeState.error,
            code: runtimeState.code,
            hints: runtimeState.hints,
        });
        return;
    }
    if (event.event === 'error') {
        runtimeState.connected = false;
        runtimeState.loggedIn = event.loginOk ?? false;
        runtimeState.targetChatAccessible = false;
        runtimeState.targetChatResolved = event.targetChatResolved ?? false;
        runtimeState.canReadMessages = event.canReadMessages ?? false;
        runtimeState.currentPhase = event.phase ?? null;
        runtimeState.error = event.message ?? 'Telegram monitor error';
        runtimeState.code = event.code ?? 'TELEGRAM_UNAVAILABLE';
        runtimeState.errorPhase = event.phase ?? null;
        runtimeState.operation = event.operation ?? null;
        runtimeState.hints = event.hints ?? [];
        runtimeState.account = event.account ?? runtimeState.account;
        runtimeState.targetChatTitle = event.targetChatInfo?.title ?? runtimeState.targetChatTitle;
        runtimeState.targetChatType = event.targetChatInfo?.type ?? runtimeState.targetChatType;
        runtimeState.stack = event.stack ?? null;
        console.error('[Telegram] Operation failed:', {
            phase: event.phase,
            operation: event.operation,
            targetChat: event.targetChat ?? runtimeState.targetChat,
            account: event.account,
            resolvedChat: event.targetChatInfo,
            loginOk: event.loginOk,
            targetChatResolved: event.targetChatResolved,
            canReadMessages: event.canReadMessages,
            name: event.errorName,
            message: event.message,
            code: event.code ?? event.errorCode,
            stack: event.stack,
            raw: event.details,
            hints: event.hints,
        });
        return;
    }
    if (event.event === 'message') {
        runtimeState.lastSyncAt = new Date().toISOString();
        runtimeState.lastProcessedMessageId = event.message.telegramMessageId;
        runtimeState.messagesFetched += 1;
        void onMessage(event.message).catch((error) => {
            console.error('[Telegram] Failed to persist incoming message:', error instanceof Error ? error.message : 'Unknown error');
        });
    }
}
function spawnMonitorProcess(executable, handlers) {
    const child = (0, node_child_process_1.spawn)(executable, [TELEGRAM_BRIDGE_SCRIPT, 'monitor'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutInterface = node_readline_1.default.createInterface({ input: child.stdout });
    const stderrInterface = node_readline_1.default.createInterface({ input: child.stderr });
    stdoutInterface.on('line', (line) => {
        const event = parseJsonLine(line);
        if (!event)
            return;
        if ('ok' in event && event.ok === false) {
            handlers.onEvent({
                event: 'error',
                code: event.code,
                message: event.message,
                details: event.details ?? null,
            });
            return;
        }
        handlers.onEvent(event);
    });
    stderrInterface.on('line', (line) => {
        if (!line.trim())
            return;
        console.error(`[Telegram] ${line.trim()}`);
    });
    child.on('error', (error) => {
        if (error.code === 'ENOENT') {
            handlers.onEvent({
                event: 'error',
                code: 'PYTHON_NOT_FOUND',
                message: `Python executable "${executable}" was not found.`,
                details: error.message,
            });
            handlers.onExit({ code: 127, signal: null });
            return;
        }
        handlers.onEvent({
            event: 'error',
            code: 'TELEGRAM_UNAVAILABLE',
            message: error.message,
            details: null,
        });
    });
    child.on('close', (code, signal) => {
        stdoutInterface.close();
        stderrInterface.close();
        handlers.onExit({ code, signal });
    });
    return child;
}
function getTelegramRuntimeState() {
    updateBaseState();
    return { ...runtimeState };
}
async function testTelegramConnection() {
    updateBaseState();
    const config = (0, telegram_js_1.getTelegramEnvConfig)();
    if (!config.enabled) {
        return {
            enabled: false,
            connected: false,
            loggedIn: false,
            targetChatAccessible: false,
            targetChatResolved: false,
            canReadMessages: false,
            messagesFetched: 0,
            currentPhase: 'load_session',
            lastMessageDate: null,
            account: null,
            targetChat: null,
            error: 'Telegram is not configured.',
            code: 'MISSING_CREDENTIALS',
            errorPhase: 'load_session',
            errorMessage: 'Telegram is not configured.',
            stack: null,
            hints: ['Configura TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION o TELEGRAM_SESSION_FILE, y TELEGRAM_TARGET_CHAT.'],
        };
    }
    if (!config.configured) {
        return {
            enabled: true,
            connected: false,
            loggedIn: false,
            targetChatAccessible: false,
            targetChatResolved: false,
            canReadMessages: false,
            messagesFetched: 0,
            currentPhase: 'load_session',
            lastMessageDate: null,
            account: null,
            targetChat: null,
            error: config.error,
            code: 'MISSING_CREDENTIALS',
            errorPhase: 'load_session',
            errorMessage: config.error,
            stack: null,
            hints: ['Revisa las variables de entorno de Telegram.'],
        };
    }
    try {
        const result = await runBridgeCommand(['test', '--json']);
        runtimeState.connected = result.connected;
        runtimeState.loggedIn = result.loggedIn ?? result.connected;
        runtimeState.targetChatAccessible = result.target_chat_accessible;
        runtimeState.targetChatResolved = result.target_chat_resolved ?? result.target_chat_accessible;
        runtimeState.canReadMessages = result.can_read_messages ?? result.target_chat_accessible;
        runtimeState.messagesFetched = 0;
        runtimeState.lastMessageDate = result.last_message_date ?? null;
        runtimeState.targetChatTitle = result.target_chat?.title ?? null;
        runtimeState.targetChatType = result.target_chat?.type ?? null;
        runtimeState.account = result.account ?? null;
        runtimeState.accountUsername = result.account?.username ?? result.account?.displayName ?? null;
        runtimeState.error = null;
        runtimeState.stack = null;
        runtimeState.code = null;
        runtimeState.currentPhase = result.current_phase ?? 'frontend_response';
        runtimeState.errorPhase = null;
        runtimeState.operation = null;
        runtimeState.hints = result.hints ?? [];
        return {
            enabled: true,
            connected: result.connected,
            loggedIn: result.loggedIn ?? result.connected,
            targetChatAccessible: result.target_chat_accessible,
            targetChatResolved: result.target_chat_resolved ?? result.target_chat_accessible,
            canReadMessages: result.can_read_messages ?? result.target_chat_accessible,
            messagesFetched: 0,
            currentPhase: result.current_phase ?? 'frontend_response',
            lastMessageDate: result.last_message_date ?? null,
            account: {
                id: result.account?.id ?? null,
                username: result.account?.username ?? null,
                displayName: result.account?.displayName ?? null,
            },
            targetChat: {
                id: result.target_chat?.id ?? null,
                title: result.target_chat?.title ?? null,
                type: result.target_chat?.type ?? null,
                username: result.target_chat?.username ?? null,
                normalized: result.target_chat?.normalized ?? null,
            },
            error: null,
            code: null,
            errorPhase: null,
            errorMessage: null,
            stack: null,
            hints: result.hints ?? [],
        };
    }
    catch (error) {
        const bridgeError = error instanceof TelegramBridgeError
            ? error
            : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error instanceof Error ? error.message : 'Telegram unavailable.');
        logBridgeFailure('[Telegram] Connection test failed:', bridgeError);
        applyConnectionFailure(bridgeError);
        return {
            enabled: true,
            connected: false,
            loggedIn: bridgeError.loginOk,
            targetChatAccessible: false,
            targetChatResolved: bridgeError.targetChatResolved,
            canReadMessages: bridgeError.canReadMessages,
            messagesFetched: 0,
            currentPhase: bridgeError.phase,
            lastMessageDate: null,
            account: bridgeError.account ?? null,
            targetChat: {
                id: bridgeError.targetChatInfo?.id ?? null,
                title: bridgeError.targetChatInfo?.title ?? null,
                type: bridgeError.targetChatInfo?.type ?? null,
                username: bridgeError.targetChatInfo?.username ?? null,
                normalized: bridgeError.targetChatInfo?.normalized ?? null,
            },
            error: bridgeError.message,
            code: bridgeError.code,
            errorPhase: bridgeError.phase,
            errorMessage: bridgeError.message,
            stack: bridgeError.stackDetails,
            hints: bridgeError.hints,
        };
    }
}
async function fetchTelegramHistory(limit, afterId) {
    updateBaseState();
    const args = ['fetch-history', '--json', '--limit', String(limit)];
    if (afterId)
        args.push('--after-id', afterId);
    runtimeState.currentPhase = 'fetch_messages';
    console.log('[Telegram] Fetching latest messages...');
    try {
        const result = await runBridgeCommand(args, 20_000);
        runtimeState.connected = true;
        runtimeState.loggedIn = result.loggedIn ?? runtimeState.loggedIn;
        runtimeState.targetChatResolved = result.target_chat_resolved ?? Boolean(result.chat);
        runtimeState.targetChatAccessible = runtimeState.targetChatResolved;
        runtimeState.canReadMessages = result.can_read_messages ?? runtimeState.canReadMessages;
        runtimeState.targetChatTitle = result.chat?.title ?? runtimeState.targetChatTitle;
        runtimeState.targetChatType = result.chat?.type ?? runtimeState.targetChatType;
        runtimeState.lastMessageDate = result.last_message_date ?? runtimeState.lastMessageDate;
        runtimeState.messagesFetched = result.messages_fetched ?? result.messages?.length ?? 0;
        runtimeState.error = null;
        runtimeState.stack = null;
        runtimeState.code = null;
        runtimeState.errorPhase = null;
        runtimeState.operation = null;
        runtimeState.hints = result.hints ?? [];
        runtimeState.currentPhase = 'frontend_response';
        console.log(`[Telegram] Messages fetched: ${runtimeState.messagesFetched}`);
        return result;
    }
    catch (error) {
        const bridgeError = error instanceof TelegramBridgeError
            ? error
            : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error instanceof Error ? error.message : 'Telegram fetch failed.');
        logBridgeFailure('[Telegram] Fetch history failed:', bridgeError);
        applyConnectionFailure(bridgeError);
        throw bridgeError;
    }
}
async function startTelegramMonitoring(onMessage) {
    updateBaseState();
    const config = (0, telegram_js_1.getTelegramEnvConfig)();
    if (!config.enabled)
        return;
    if (!config.configured) {
        console.warn(`[Telegram] ${config.error}`);
        return;
    }
    if (monitorProcess)
        return;
    intentionalMonitorStop = false;
    const executables = resolvedPythonExecutable ? [resolvedPythonExecutable] : PYTHON_CANDIDATES;
    let started = false;
    for (const executable of executables) {
        try {
            monitorProcess = spawnMonitorProcess(executable, {
                onEvent: (event) => handleMonitorEvent(event, onMessage),
                onExit: ({ code, signal }) => {
                    monitorProcess = null;
                    if (intentionalMonitorStop)
                        return;
                    runtimeState.connected = false;
                    runtimeState.targetChatAccessible = false;
                    if (code !== 0) {
                        console.warn(`[Telegram] Monitor exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}. Retrying...`);
                    }
                    scheduleMonitorRestart(onMessage);
                },
            });
            resolvedPythonExecutable = executable;
            started = true;
            break;
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                continue;
            throw error;
        }
    }
    if (!started) {
        runtimeState.error = 'Python was not found. Install Python 3 or set TELEGRAM_PYTHON_BIN.';
        runtimeState.code = 'PYTHON_NOT_FOUND';
        console.error(`[Telegram] ${runtimeState.error}`);
    }
}
function stopTelegramMonitoring() {
    intentionalMonitorStop = true;
    if (monitorRestartTimer) {
        clearTimeout(monitorRestartTimer);
        monitorRestartTimer = null;
    }
    if (monitorProcess) {
        monitorProcess.kill('SIGTERM');
        monitorProcess = null;
    }
}
async function runTelegramDoctor() {
    const scriptPath = TELEGRAM_BRIDGE_SCRIPT;
    // Check script exists
    let scriptExists = false;
    try {
        const { existsSync } = await Promise.resolve().then(() => __importStar(require('node:fs')));
        scriptExists = existsSync(scriptPath);
    }
    catch { /* ignore */ }
    // Check python availability and version
    let pythonFound = false;
    let pythonVersion = null;
    let pythonExecutable = null;
    for (const candidate of PYTHON_CANDIDATES) {
        const result = (0, node_child_process_1.spawnSync)(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (result.error == null && result.status === 0) {
            pythonFound = true;
            pythonVersion = (result.stdout || result.stderr || '').trim().split('\n')[0] ?? null;
            pythonExecutable = candidate;
            break;
        }
    }
    // Check env var presence (no values)
    const envVarKeys = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'TELEGRAM_TARGET_CHAT', 'TELEGRAM_SESSION_FILE'];
    const envVars = Object.fromEntries(envVarKeys.map((k) => [k, Boolean(process.env[k]?.trim())]));
    if (!pythonFound || !scriptExists) {
        return {
            python_found: pythonFound,
            python_version: pythonVersion,
            python_executable: pythonExecutable,
            script_exists: scriptExists,
            script_path: scriptPath,
            env_vars: envVars,
            doctor: null,
            doctor_error: pythonFound ? 'Bridge script not found' : 'Python not found',
            error_code: pythonFound ? 'SCRIPT_NOT_FOUND' : 'PYTHON_NOT_FOUND',
            raw_stderr: null,
        };
    }
    // Run doctor command via the resolved executable
    try {
        const result = await tryRunPythonCommand(pythonExecutable ?? 'python3', ['doctor', '--json'], 15_000);
        const doctor = parseJsonLine(result.stdout.trim().split('\n').findLast(Boolean) ?? '');
        return {
            python_found: true,
            python_version: pythonVersion,
            python_executable: pythonExecutable,
            script_exists: scriptExists,
            script_path: scriptPath,
            env_vars: envVars,
            doctor,
            doctor_error: null,
            error_code: null,
            raw_stderr: result.stderr.trim() || null,
        };
    }
    catch (error) {
        const bridgeError = error instanceof TelegramBridgeError ? error : null;
        return {
            python_found: true,
            python_version: pythonVersion,
            python_executable: pythonExecutable,
            script_exists: scriptExists,
            script_path: scriptPath,
            env_vars: envVars,
            doctor: null,
            doctor_error: error instanceof Error ? error.message : String(error),
            error_code: bridgeError?.code ?? 'DOCTOR_FAILED',
            raw_stderr: null,
        };
    }
}
