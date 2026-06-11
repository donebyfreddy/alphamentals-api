import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { getTelegramEnvConfig } from '../config/telegram.js';
import type {
  TelegramAttachmentMetadata,
  TelegramConnectionTestResult,
  TelegramReplyInfo,
} from '../types/telegram.js';

type BridgeErrorPayload = {
  ok?: boolean;
  code?: string;
  message?: string;
  details?: string | null;
  phase?: string | null;
  operation?: string | null;
  targetChat?: string | null;
  loginOk?: boolean;
  targetChatResolved?: boolean;
  canReadMessages?: boolean;
  account?: BridgeAccountPayload | null;
  targetChatInfo?: BridgeChatPayload & { username?: string | null; normalized?: string | null } | null;
  hints?: string[] | null;
  errorName?: string | null;
  errorCode?: string | null;
  stack?: string | null;
};

type BridgeChatPayload = {
  id?: string | null;
  title?: string | null;
  type?: string | null;
  username?: string | null;
  normalized?: string | null;
};

type BridgeAccountPayload = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
};

export type TelegramBridgeMessagePayload = {
  telegramMessageId: string;
  chatId: string;
  chatTitle: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  rawText: string;
  replyInfo: TelegramReplyInfo | null;
  telegramDate: string;
  attachments: TelegramAttachmentMetadata[];
};

type TestCommandSuccess = {
  ok: true;
  connected: boolean;
  loggedIn?: boolean;
  target_chat_accessible: boolean;
  target_chat_resolved?: boolean;
  can_read_messages?: boolean;
  current_phase?: string | null;
  last_message_date?: string | null;
  error_phase?: string | null;
  error_code?: string | null;
  hints?: string[] | null;
  account?: BridgeAccountPayload;
  target_chat?: BridgeChatPayload;
};

type FetchHistorySuccess = {
  ok: true;
  chat?: BridgeChatPayload;
  messages?: TelegramBridgeMessagePayload[];
  messages_fetched?: number;
  loggedIn?: boolean;
  target_chat_resolved?: boolean;
  can_read_messages?: boolean;
  last_message_date?: string | null;
  hints?: string[] | null;
};

type DoctorCommandSuccess = {
  ok: true;
  python_version?: string;
  telethon_installed?: boolean;
  dotenv_loaded?: boolean;
  session_configured?: boolean;
  session_source?: string | null;
  session_error?: string | null;
  api_id_configured?: boolean;
  api_hash_configured?: boolean;
  target_chat_configured?: boolean;
  working_directory?: string | null;
};

type MonitorStatusEvent = {
  event: 'status';
  stage: 'session_loaded' | 'connecting' | 'logged_in' | 'resolving_target_chat' | 'target_chat_connected' | 'reading_messages' | 'message_read_test_ok' | 'monitoring_enabled';
  phase?: string;
  message?: string;
  username?: string | null;
  displayName?: string | null;
  chatId?: string | null;
  chatTitle?: string | null;
  chatType?: string | null;
  targetChat?: string | null;
  targetChatNormalized?: string | null;
  loginOk?: boolean;
  targetChatResolved?: boolean;
  canReadMessages?: boolean;
  account?: BridgeAccountPayload | null;
  lastMessageDate?: string | null;
  sessionSource?: string | null;
  sessionFile?: string | null;
};

type MonitorMessageEvent = {
  event: 'message';
  message: TelegramBridgeMessagePayload;
};

type MonitorErrorEvent = {
  event: 'error' | 'warning';
  code?: string;
  message?: string;
  details?: string | null;
  phase?: string | null;
  operation?: string | null;
  targetChat?: string | null;
  loginOk?: boolean;
  targetChatResolved?: boolean;
  canReadMessages?: boolean;
  account?: BridgeAccountPayload | null;
  targetChatInfo?: BridgeChatPayload | null;
  hints?: string[] | null;
  errorName?: string | null;
  errorCode?: string | null;
  stack?: string | null;
};

type MonitorEvent = MonitorStatusEvent | MonitorMessageEvent | MonitorErrorEvent;

type MonitorHandlers = {
  onEvent: (event: MonitorEvent) => void;
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
};

type TelegramBridgeRuntimeState = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  loggedIn: boolean;
  targetChatAccessible: boolean;
  targetChat: string | null;
  targetChatTitle: string | null;
  targetChatType: string | null;
  accountUsername: string | null;
  account: BridgeAccountPayload | null;
  targetChatResolved: boolean;
  canReadMessages: boolean;
  messagesFetched: number;
  lastMessageDate: string | null;
  error: string | null;
  stack: string | null;
  code: string | null;
  currentPhase: string | null;
  errorPhase: string | null;
  operation: string | null;
  hints: string[];
  lastSyncAt: string | null;
  lastProcessedMessageId: string | null;
};

type BridgeScriptResolution = { scriptPath: string; checkedPaths: string[] };

// Resolve the Telegram bridge script path. Allow override via env var.
// TELEGRAM_BRIDGE_SCRIPT_PATH and TELEGRAM_PYTHON_SCRIPT are both accepted.
// Searches common locations across various project structures.
function resolveBridgeScript(): BridgeScriptResolution {
  const envPath = (process.env.TELEGRAM_BRIDGE_SCRIPT_PATH?.trim() || process.env.TELEGRAM_PYTHON_SCRIPT?.trim()) || null;
  if (envPath) {
    console.log(`[telegram] resolving bridge script from env: ${envPath}`);
    return { scriptPath: envPath, checkedPaths: [envPath] };
  }
  const candidates = [
    path.join(process.cwd(), 'backend', 'scripts', 'telegram_bridge.py'),
    path.join(process.cwd(), 'backend', 'server', 'scripts', 'telegram_bridge.py'),
    path.join(process.cwd(), 'backend', 'services', 'telegram_bridge.py'),
    path.join(process.cwd(), 'backend', 'telegram_bridge.py'),
    path.join(process.cwd(), 'scripts', 'telegram_bridge.py'),
    path.join(process.cwd(), 'api', 'scripts', 'telegram_bridge.py'),
    path.join(process.cwd(), 'telegram_bridge.py'),
  ];
  console.log('[telegram] resolving bridge script');
  console.log('[telegram] checked script paths:', candidates.join(', '));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[telegram] selected script: ${p}`);
      return { scriptPath: p, checkedPaths: candidates };
    }
  }
  console.warn('[telegram] bridge script not found. Checked:', candidates.join(', '));
  // Return default path so error messages show an expected location; checkedPaths surfaces all tried locations.
  return { scriptPath: candidates[4], checkedPaths: candidates };
}

const _bridgeScriptResolution = resolveBridgeScript();
const TELEGRAM_BRIDGE_SCRIPT = _bridgeScriptResolution.scriptPath;
const TELEGRAM_CHECKED_SCRIPT_PATHS = _bridgeScriptResolution.checkedPaths;

function isBridgeScriptPresent(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  return existsSync(TELEGRAM_BRIDGE_SCRIPT);
}

// PythonSpec: cmd = executable, cmdArgs = version args prepended before the script.
// e.g. { cmd: 'py', cmdArgs: ['-3.11'], label: 'py -3.11' }
type PythonSpec = { cmd: string; cmdArgs: string[]; label: string };

// Resolution order:
// 1. Explicit env override: TELEGRAM_PYTHON_PATH, TELEGRAM_PYTHON_BIN, PYTHON_EXECUTABLE
// 2. Venv paths that EXIST on disk (checked with existsSync — no ENOENT)
// 3. Windows py launcher: py -3.11, then py (correct 2-arg spawn)
// 4. Standard names: python3, python
function buildPythonCandidates(): PythonSpec[] {
  // Use synchronous existsSync to filter venv paths that actually exist
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require('node:fs') as typeof import('node:fs');

  const explicit: PythonSpec[] = [
    process.env.TELEGRAM_PYTHON_PATH?.trim(),
    process.env.TELEGRAM_PYTHON_BIN?.trim(),
    process.env.PYTHON_EXECUTABLE?.trim(),
  ]
    .filter(Boolean)
    .map((cmd) => ({ cmd: cmd!, cmdArgs: [], label: `env:${cmd}` }));

  // Only include venv paths that actually exist — prevents ENOENT on missing venv
  const venvPaths: PythonSpec[] = [
    path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
    path.join(process.cwd(), '.venv', 'bin', 'python'),
    path.join(process.cwd(), 'mt5bridge', '.venv', 'Scripts', 'python.exe'),
    path.join(process.cwd(), 'mt5bridge', '.venv', 'bin', 'python'),
  ]
    .filter((p) => { try { return existsSync(p); } catch { return false; } })
    .map((p) => ({ cmd: p, cmdArgs: [], label: `venv:${path.basename(p)}` }));

  // Known Windows system Python installations — only include if the exe exists.
  const windowsPaths: PythonSpec[] = [
    String.raw`C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe`,
  ]
    .filter((p) => { try { return existsSync(p); } catch { return false; } })
    .map((p) => ({ cmd: p, cmdArgs: [], label: 'win:python311' }));

  const standard: PythonSpec[] = [
    // py -3.11: spawn('py', ['-3.11', script, ...args]) — Windows version-specific launcher
    { cmd: 'py', cmdArgs: ['-3.11'], label: 'py -3.11' },
    { cmd: 'py', cmdArgs: [], label: 'py' },
    { cmd: 'python3', cmdArgs: [], label: 'python3' },
    { cmd: 'python', cmdArgs: [], label: 'python' },
  ];

  const all = [...explicit, ...venvPaths, ...windowsPaths, ...standard];
  console.log('[telegram] Python candidates:', all.map((s) => s.label).join(', '));
  return all;
}

const PYTHON_CANDIDATES: PythonSpec[] = buildPythonCandidates();

let resolvedPythonSpec: PythonSpec | null = null;
let monitorProcess: ReturnType<typeof spawn> | null = null;
let monitorRestartTimer: NodeJS.Timeout | null = null;
let intentionalMonitorStop = false;

const runtimeState: TelegramBridgeRuntimeState = {
  enabled: false,
  configured: false,
  connected: false,
  loggedIn: false,
  targetChatAccessible: false,
  targetChat: getTelegramEnvConfig().targetChat,
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

export class TelegramBridgeError extends Error {
  code: string;
  details: string | null;
  status: number;
  phase: string | null;
  operation: string | null;
  targetChat: string | null;
  loginOk: boolean;
  targetChatResolved: boolean;
  canReadMessages: boolean;
  account: BridgeAccountPayload | null;
  targetChatInfo: BridgeChatPayload | null;
  hints: string[];
  errorName: string | null;
  errorCode: string | null;
  stackDetails: string | null;

  constructor(code: string, message: string, details: string | null = null, context: Partial<BridgeErrorPayload> = {}) {
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

function parseJsonLine<T>(line: string): T | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function mapBridgeErrorCodeToHttpStatus(code: string) {
  if (code === 'MISSING_CREDENTIALS' || code === 'INVALID_API_ID' || code === 'INVALID_TARGET_CHAT') return 400;
  if (code === 'INVALID_API_CREDENTIALS' || code === 'INVALID_SESSION') return 401;
  if (code === 'TARGET_CHAT_ACCESS_DENIED') return 403;
  if (code === 'TELEGRAM_RATE_LIMIT') return 429;
  return 503;
}

function toBridgeError(payload: BridgeErrorPayload | null, fallbackMessage: string) {
  return new TelegramBridgeError(
    payload?.code ?? 'TELEGRAM_UNAVAILABLE',
    payload?.message ?? fallbackMessage,
    payload?.details ?? null,
    payload ?? {},
  );
}

async function tryRunPythonCommand(spec: PythonSpec, args: string[], timeoutMs: number) {
  return await new Promise<{ stdout: string; stderr: string; spec: PythonSpec }>((resolve, reject) => {
    // Correctly prepend version args: spawn('py', ['-3.11', script, ...args])
    const child = spawn(spec.cmd, [...spec.cmdArgs, TELEGRAM_BRIDGE_SCRIPT, ...args], {
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

    child.on('error', (error: NodeJS.ErrnoException) => {
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
        resolve({ stdout, stderr, spec });
        return;
      }

      const stdoutLines = stdout.trim().split('\n').filter(Boolean);
      const stderrLines = stderr.trim().split('\n').filter(Boolean);
      const payload = parseJsonLine<BridgeErrorPayload>(stdoutLines.at(-1) ?? '') ?? parseJsonLine<BridgeErrorPayload>(stderrLines.at(-1) ?? '');
      reject(toBridgeError(payload, stderr.trim() || stdout.trim() || 'Telegram command failed.'));
    });
  });
}

async function runBridgeCommand<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  if (!isBridgeScriptPresent()) {
    throw new TelegramBridgeError(
      'SCRIPT_NOT_FOUND',
      `Telegram bridge script not found. Checked: ${TELEGRAM_CHECKED_SCRIPT_PATHS.join(', ')}`,
      null,
      { phase: 'TELEGRAM_SCRIPT_NOT_FOUND' },
    );
  }

  const specs = resolvedPythonSpec ? [resolvedPythonSpec] : PYTHON_CANDIDATES;
  let lastError: unknown = null;

  for (const spec of specs) {
    try {
      const result = await tryRunPythonCommand(spec, args, timeoutMs);
      resolvedPythonSpec = result.spec;
      console.log(`[Telegram] using python: ${spec.label}`);

      const payload = parseJsonLine<T>(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '');
      if (!payload) {
        throw new TelegramBridgeError('TELEGRAM_UNAVAILABLE', result.stderr.trim() || 'Telegram bridge returned invalid JSON.');
      }

      return payload;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new TelegramBridgeError('PYTHON_NOT_FOUND', 'Python was not found. Install Python 3 or set TELEGRAM_PYTHON_PATH.');
}

function applyConnectionFailure(error: TelegramBridgeError | Error) {
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
  const config = getTelegramEnvConfig();
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
  } else if (!config.enabled) {
    runtimeState.error = null;
    runtimeState.stack = null;
    runtimeState.code = null;
    runtimeState.currentPhase = null;
    runtimeState.errorPhase = null;
    runtimeState.hints = [];
  }
}

function logBridgeFailure(prefix: string, error: TelegramBridgeError | Error) {
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

function maskSession(value: string | null) {
  if (!value) return null;
  if (value.length <= 10) return 'configured';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export async function logTelegramStartupDiagnostics() {
  updateBaseState();
  const config = getTelegramEnvConfig();
  const preferredPython = process.env.TELEGRAM_PYTHON_PATH?.trim()
    || process.env.TELEGRAM_PYTHON_BIN?.trim()
    || process.env.PYTHON_EXECUTABLE?.trim()
    || null;

  const scriptPresent = isBridgeScriptPresent();

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
    scriptPath: TELEGRAM_BRIDGE_SCRIPT,
    scriptPresent,
    pythonCandidates: PYTHON_CANDIDATES.map((s) => s.label),
    resolvedPython: resolvedPythonSpec?.label ?? null,
    preferredPython,
    workingDirectory: process.cwd(),
    renderService: process.env.RENDER_SERVICE_NAME ?? null,
    renderInstance: process.env.RENDER_INSTANCE_ID ?? null,
    renderUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    sessionPreview: maskSession(config.session),
  });

  if (!scriptPresent) {
    runtimeState.error = `Telegram bridge script not found: ${TELEGRAM_BRIDGE_SCRIPT}. Telegram sync is disabled. Create the script or set TELEGRAM_PYTHON_SCRIPT env var.`;
    runtimeState.code = 'SCRIPT_NOT_FOUND';
    console.warn(`[Telegram] Bridge script not found at ${TELEGRAM_BRIDGE_SCRIPT} — Telegram disabled. Set TELEGRAM_PYTHON_SCRIPT to override the path.`);
    return;
  }

  try {
    const doctor = await runBridgeCommand<DoctorCommandSuccess>(['doctor', '--json']);
    console.log('[Telegram] Python bridge diagnostics', doctor);
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError
      ? error
      : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error instanceof Error ? error.message : 'Telegram doctor failed.');
    logBridgeFailure('[Telegram] Python bridge diagnostics failed:', bridgeError);
  }
}

function scheduleMonitorRestart(onMessage: (message: TelegramBridgeMessagePayload) => Promise<void>) {
  if (intentionalMonitorStop || monitorRestartTimer || !runtimeState.configured) return;
  // Do not restart if the script is permanently missing — avoids an infinite loop.
  if (runtimeState.code === 'SCRIPT_NOT_FOUND') return;

  monitorRestartTimer = setTimeout(() => {
    monitorRestartTimer = null;
    void startTelegramMonitoring(onMessage);
  }, 5_000);
}

function handleMonitorEvent(event: MonitorEvent, onMessage: (message: TelegramBridgeMessagePayload) => Promise<void>) {
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

function spawnMonitorProcess(spec: PythonSpec, handlers: MonitorHandlers) {
  const child = spawn(spec.cmd, [...spec.cmdArgs, TELEGRAM_BRIDGE_SCRIPT, 'monitor'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutInterface = readline.createInterface({ input: child.stdout });
  const stderrInterface = readline.createInterface({ input: child.stderr });

  stdoutInterface.on('line', (line) => {
    const event = parseJsonLine<MonitorEvent | BridgeErrorPayload>(line);
    if (!event) return;

    if ('ok' in event && event.ok === false) {
      handlers.onEvent({
        event: 'error',
        code: event.code,
        message: event.message,
        details: event.details ?? null,
      });
      return;
    }

    handlers.onEvent(event as MonitorEvent);
  });

  stderrInterface.on('line', (line) => {
    if (!line.trim()) return;
    console.error(`[Telegram] ${line.trim()}`);
  });

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      handlers.onEvent({
        event: 'error',
        code: 'PYTHON_NOT_FOUND',
        message: `Python executable "${spec.label}" was not found.`,
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

export function getTelegramRuntimeState() {
  updateBaseState();
  return { ...runtimeState };
}

export function getTelegramScriptDiagnostics() {
  const scriptPresent = isBridgeScriptPresent();
  const config = getTelegramEnvConfig();

  let phase: string;
  if (config.enabled && scriptPresent) {
    phase = runtimeState.currentPhase ?? runtimeState.errorPhase ?? 'TELEGRAM_UNAVAILABLE';
  } else if (config.enabled) {
    phase = 'TELEGRAM_SCRIPT_NOT_FOUND';
  } else {
    phase = 'TELEGRAM_NOT_CONFIGURED';
  }

  console.log(`[telegram] selected python: ${resolvedPythonSpec?.label ?? 'none'}`);
  console.log(`[telegram] target chat: ${config.targetChat ?? 'not set'}`);

  return {
    configured: runtimeState.configured,
    available: runtimeState.connected,
    phase,
    selectedPython: resolvedPythonSpec?.label ?? null,
    selectedScript: scriptPresent ? TELEGRAM_BRIDGE_SCRIPT : null,
    checkedScriptPaths: TELEGRAM_CHECKED_SCRIPT_PATHS,
    targetChat: config.targetChat ?? null,
    resolvedChat: runtimeState.targetChatTitle ?? null,
    lastError: scriptPresent ? runtimeState.error : `Telegram bridge script not found. Checked: ${TELEGRAM_CHECKED_SCRIPT_PATHS.join(', ')}`,
  };
}

export async function testTelegramConnection(): Promise<TelegramConnectionTestResult> {
  updateBaseState();
  const config = getTelegramEnvConfig();

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
    const result = await runBridgeCommand<TestCommandSuccess>(['test', '--json']);
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
  } catch (error) {
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
      account: bridgeError.account?.id && bridgeError.account?.username && bridgeError.account?.displayName
        ? { id: bridgeError.account.id, username: bridgeError.account.username, displayName: bridgeError.account.displayName }
        : null,
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

export async function fetchTelegramHistory(limit: number, afterId?: string | null) {
  updateBaseState();
  const args = ['fetch-history', '--json', '--limit', String(limit)];
  if (afterId) args.push('--after-id', afterId);
  runtimeState.currentPhase = 'fetch_messages';
  console.log('[Telegram] Fetching latest messages...');

  try {
    const result = await runBridgeCommand<FetchHistorySuccess>(args, 20_000);
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
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError
      ? error
      : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', error instanceof Error ? error.message : 'Telegram fetch failed.');
    logBridgeFailure('[Telegram] Fetch history failed:', bridgeError);
    applyConnectionFailure(bridgeError);
    throw bridgeError;
  }
}

export async function startTelegramMonitoring(onMessage: (message: TelegramBridgeMessagePayload) => Promise<void>) {
  updateBaseState();
  const config = getTelegramEnvConfig();

  if (!config.enabled) return;
  if (!config.configured) {
    console.warn(`[Telegram] ${config.error}`);
    return;
  }

  // Hard-stop if the Python bridge script is missing — do NOT schedule restarts.
  if (!isBridgeScriptPresent()) {
    runtimeState.error = `Telegram bridge script not found: ${TELEGRAM_BRIDGE_SCRIPT}. Telegram sync disabled. Create the script or set TELEGRAM_PYTHON_SCRIPT env var.`;
    runtimeState.code = 'SCRIPT_NOT_FOUND';
    console.warn(`[Telegram] Bridge script not found: ${TELEGRAM_BRIDGE_SCRIPT}. Monitoring will not start.`);
    return;
  }

  if (monitorProcess) return;

  intentionalMonitorStop = false;

  const specs = resolvedPythonSpec ? [resolvedPythonSpec] : PYTHON_CANDIDATES;
  let started = false;

  for (const spec of specs) {
    try {
      monitorProcess = spawnMonitorProcess(spec, {
        onEvent: (event) => handleMonitorEvent(event, onMessage),
        onExit: ({ code, signal }) => {
          monitorProcess = null;
          if (intentionalMonitorStop) return;
          runtimeState.connected = false;
          runtimeState.targetChatAccessible = false;
          if (code !== 0) {
            console.warn(`[Telegram] Monitor exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}. Retrying...`);
          }
          scheduleMonitorRestart(onMessage);
        },
      });
      resolvedPythonSpec = spec;
      console.log(`[Telegram] script=${TELEGRAM_BRIDGE_SCRIPT} python=${spec.label} target=${config.targetChat ?? 'not set'}`);
      started = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw error;
    }
  }

  if (!started) {
    runtimeState.error = 'Python was not found. Install Python 3 or set TELEGRAM_PYTHON_PATH.';
    runtimeState.code = 'PYTHON_NOT_FOUND';
    console.error(`[Telegram] Python not found. Tried: ${PYTHON_CANDIDATES.map((s) => s.label).join(', ')}`);
  }
}

export function stopTelegramMonitoring() {
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

export async function runTelegramDoctor(): Promise<{
  python_found: boolean;
  python_version: string | null;
  python_executable: string | null;
  script_exists: boolean;
  script_path: string;
  env_vars: Record<string, boolean>;
  doctor: DoctorCommandSuccess | null;
  doctor_error: string | null;
  error_code: string | null;
  raw_stderr: string | null;
}> {
  const scriptPath = TELEGRAM_BRIDGE_SCRIPT;

  // Check script exists
  let scriptExists = false;
  try {
    const { existsSync } = await import('node:fs');
    scriptExists = existsSync(scriptPath);
  } catch { /* ignore */ }

  // Check python availability and version — try each candidate until one works
  let pythonFound = false;
  let pythonVersion: string | null = null;
  let pythonExecutable: string | null = null;
  for (const spec of PYTHON_CANDIDATES) {
    const result = spawnSync(spec.cmd, [...spec.cmdArgs, '--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.error == null && result.status === 0) {
      pythonFound = true;
      pythonVersion = (result.stdout || result.stderr || '').trim().split('\n')[0] ?? null;
      pythonExecutable = spec.label;
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

  // Run doctor command via the first working candidate
  const docSpec = PYTHON_CANDIDATES.find((s) => {
    const r = spawnSync(s.cmd, [...s.cmdArgs, '--version'], { encoding: 'utf8', timeout: 3000 });
    return r.error == null && r.status === 0;
  }) ?? { cmd: 'python3', cmdArgs: [], label: 'python3' };
  try {
    const result = await tryRunPythonCommand(docSpec, ['doctor', '--json'], 15_000);
    const doctor = parseJsonLine<DoctorCommandSuccess>(result.stdout.trim().split('\n').reverse().find(Boolean) ?? '');
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
  } catch (error) {
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
