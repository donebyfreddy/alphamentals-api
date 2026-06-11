/**
 * Telegram Bridge Service
 *
 * Spawns api/scripts/telegram_fetch_latest.py (Telethon-based) to fetch the
 * latest messages from a configured Telegram group and filter XAUUSD/GOLD
 * limit-order signals.
 *
 * The old Python monitor-process approach has been removed.  This service
 * makes one-shot subprocess calls (fetch-latest, test, doctor) instead.
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getTelegramEnvConfig } from '../config/telegram.js';
import type {
  TelegramAttachmentMetadata,
  TelegramConnectionTestResult,
  TelegramReplyInfo,
} from '../types/telegram.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

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

export type TelegramLimitSignal = {
  id: string;
  messageId: string;
  chatId: string;
  rawText: string;
  symbol: 'XAUUSD';
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT';
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  sentAt: string;
  source: 'telegram';
};

// ─────────────────────────────────────────────────────────────────────────────
// Script resolution
// ─────────────────────────────────────────────────────────────────────────────

type BridgeScriptResolution = { scriptPath: string; checkedPaths: string[] };

function resolveBridgeScript(): BridgeScriptResolution {
  const envPath =
    process.env.TELEGRAM_BRIDGE_SCRIPT_PATH?.trim() ||
    process.env.TELEGRAM_PYTHON_SCRIPT?.trim() ||
    null;

  if (envPath) {
    console.log(`[telegram] resolving bridge script from env: ${envPath}`);
    return { scriptPath: envPath, checkedPaths: [envPath] };
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'api', 'scripts', 'telegram_fetch_latest.py'),
    path.join(cwd, 'scripts', 'telegram_fetch_latest.py'),
    path.join(cwd, 'backend', 'scripts', 'telegram_fetch_latest.py'),
    path.join(cwd, 'telegram_fetch_latest.py'),
  ];

  console.log('[telegram] resolving bridge script');
  console.log('[telegram] checked script paths:', candidates.join(', '));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[telegram] selected script: ${p}`);
        return { scriptPath: p, checkedPaths: candidates };
      }
    } catch { /* skip */ }
  }

  console.warn('[telegram] bridge script not found. Checked:', candidates.join(', '));
  return { scriptPath: candidates[0], checkedPaths: candidates };
}

const _scriptResolution = resolveBridgeScript();
const TELEGRAM_BRIDGE_SCRIPT = _scriptResolution.scriptPath;
const TELEGRAM_CHECKED_SCRIPT_PATHS = _scriptResolution.checkedPaths;

function isBridgeScriptPresent(): boolean {
  try {
    return fs.existsSync(TELEGRAM_BRIDGE_SCRIPT);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Python executable resolution
// ─────────────────────────────────────────────────────────────────────────────

type PythonSpec = { cmd: string; cmdArgs: string[]; label: string };

function buildPythonCandidates(): PythonSpec[] {
  const cwd = process.cwd();

  const explicit: PythonSpec[] = (
    [
      process.env.TELEGRAM_PYTHON_PATH?.trim(),
      process.env.TELEGRAM_PYTHON_BIN?.trim(),
      process.env.PYTHON_EXECUTABLE?.trim(),
    ] as (string | undefined)[]
  )
    .filter((v): v is string => Boolean(v))
    .map((cmd) => ({ cmd, cmdArgs: [], label: `env:${cmd}` }));

  const venvPaths: PythonSpec[] = [
    path.join(cwd, '.venv', 'Scripts', 'python.exe'),
    path.join(cwd, '.venv', 'bin', 'python'),
    path.join(cwd, 'mt5bridge', '.venv', 'Scripts', 'python.exe'),
    path.join(cwd, 'mt5bridge', '.venv', 'bin', 'python'),
  ]
    .filter((p) => { try { return fs.existsSync(p); } catch { return false; } })
    .map((p) => ({ cmd: p, cmdArgs: [], label: `venv:${path.basename(p)}` }));

  const windowsPaths: PythonSpec[] = [
    String.raw`C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe`,
  ]
    .filter((p) => { try { return fs.existsSync(p); } catch { return false; } })
    .map((p) => ({ cmd: p, cmdArgs: [], label: 'win:python311' }));

  const standard: PythonSpec[] = [
    { cmd: 'py', cmdArgs: ['-3.11'], label: 'py -3.11' },
    { cmd: 'py', cmdArgs: [],       label: 'py' },
    { cmd: 'python3', cmdArgs: [],  label: 'python3' },
    { cmd: 'python',  cmdArgs: [],  label: 'python' },
  ];

  const all = [...explicit, ...venvPaths, ...windowsPaths, ...standard];
  console.log('[telegram] Python candidates:', all.map((s) => s.label).join(', '));
  return all;
}

const PYTHON_CANDIDATES: PythonSpec[] = buildPythonCandidates();
let resolvedPythonSpec: PythonSpec | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// TelegramBridgeError
// ─────────────────────────────────────────────────────────────────────────────

type BridgeErrorContext = {
  phase?: string | null;
  operation?: string | null;
  targetChat?: string | null;
  loginOk?: boolean;
  targetChatResolved?: boolean;
  canReadMessages?: boolean;
  account?: { id?: string | null; username?: string | null; displayName?: string | null } | null;
  targetChatInfo?: { id?: string | null; title?: string | null; type?: string | null; username?: string | null; normalized?: string | null } | null;
  hints?: string[] | null;
  errorName?: string | null;
  errorCode?: string | null;
  stack?: string | null;
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
  account: BridgeErrorContext['account'];
  targetChatInfo: BridgeErrorContext['targetChatInfo'];
  hints: string[];
  errorName: string | null;
  errorCode: string | null;
  stackDetails: string | null;

  constructor(code: string, message: string, details: string | null = null, ctx: BridgeErrorContext = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = mapCodeToStatus(code);
    this.phase = ctx.phase ?? null;
    this.operation = ctx.operation ?? null;
    this.targetChat = ctx.targetChat ?? null;
    this.loginOk = ctx.loginOk ?? false;
    this.targetChatResolved = ctx.targetChatResolved ?? false;
    this.canReadMessages = ctx.canReadMessages ?? false;
    this.account = ctx.account ?? null;
    this.targetChatInfo = ctx.targetChatInfo ?? null;
    this.hints = ctx.hints ?? [];
    this.errorName = ctx.errorName ?? null;
    this.errorCode = ctx.errorCode ?? null;
    this.stackDetails = ctx.stack ?? null;
  }
}

function mapCodeToStatus(code: string): number {
  if (code === 'MISSING_CREDENTIALS' || code === 'INVALID_API_ID' || code === 'INVALID_TARGET_CHAT') return 400;
  if (code === 'INVALID_API_CREDENTIALS' || code === 'INVALID_SESSION') return 401;
  if (code === 'TARGET_CHAT_ACCESS_DENIED') return 403;
  if (code === 'TELEGRAM_RATE_LIMIT') return 429;
  return 503;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime state
// ─────────────────────────────────────────────────────────────────────────────

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
  account: BridgeErrorContext['account'];
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

function syncBaseState() {
  const cfg = getTelegramEnvConfig();
  runtimeState.enabled = cfg.enabled;
  runtimeState.configured = cfg.configured;
  runtimeState.targetChat = cfg.targetChat;
  if (cfg.error && cfg.enabled) {
    runtimeState.error = cfg.error;
    runtimeState.code = 'MISSING_CREDENTIALS';
    runtimeState.currentPhase = 'load_session';
    runtimeState.errorPhase = 'load_session';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core subprocess helper
// ─────────────────────────────────────────────────────────────────────────────

function parseLastJsonLine<T>(output: string): T | null {
  const lines = output.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as T;
    } catch { /* continue */ }
  }
  return null;
}

async function spawnScript(spec: PythonSpec, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.cmd, [...spec.cmdArgs, TELEGRAM_BRIDGE_SCRIPT, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TelegramBridgeError('TELEGRAM_TIMEOUT', 'Telegram request timed out.'));
    }, timeoutMs);

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') { reject(err); return; }
      reject(new TelegramBridgeError('TELEGRAM_UNAVAILABLE', err.message));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(stdout); return; }
      const payload = parseLastJsonLine<{ code?: string; message?: string; phase?: string }>(stdout) ??
                      parseLastJsonLine<{ code?: string; message?: string; phase?: string }>(stderr);
      const msg = payload?.message ?? (stderr.trim() || stdout.trim() || 'Telegram command failed.');
      const errCode = payload?.code ?? 'TELEGRAM_UNAVAILABLE';
      reject(new TelegramBridgeError(errCode, msg, null, { phase: payload?.phase ?? null }));
    });
  });
}

async function runScript<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  if (!isBridgeScriptPresent()) {
    throw new TelegramBridgeError(
      'SCRIPT_NOT_FOUND',
      `Telegram bridge script not found. Checked: ${TELEGRAM_CHECKED_SCRIPT_PATHS.join(', ')}`,
      null,
      { phase: 'TELEGRAM_SCRIPT_NOT_FOUND' },
    );
  }

  const specs = resolvedPythonSpec ? [resolvedPythonSpec] : PYTHON_CANDIDATES;
  let lastErr: unknown = null;

  for (const spec of specs) {
    try {
      const raw = await spawnScript(spec, args, timeoutMs);
      resolvedPythonSpec = spec;
      console.log(`[telegram] using python: ${spec.label}`);

      const payload = parseLastJsonLine<T>(raw);
      if (!payload) {
        throw new TelegramBridgeError('TELEGRAM_UNAVAILABLE', 'Telegram bridge returned invalid JSON.');
      }
      return payload;
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw err;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new TelegramBridgeError('PYTHON_NOT_FOUND', 'Python not found. Install Python 3 or set TELEGRAM_PYTHON_PATH.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function getTelegramRuntimeState() {
  syncBaseState();
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

  return {
    configured: runtimeState.configured,
    available: runtimeState.connected,
    phase,
    selectedPython: resolvedPythonSpec?.label ?? null,
    selectedScript: scriptPresent ? TELEGRAM_BRIDGE_SCRIPT : null,
    checkedScriptPaths: TELEGRAM_CHECKED_SCRIPT_PATHS,
    targetChat: config.targetChat ?? null,
    resolvedChat: runtimeState.targetChatTitle ?? null,
    lastError: scriptPresent
      ? runtimeState.error
      : `Telegram bridge script not found. Checked: ${TELEGRAM_CHECKED_SCRIPT_PATHS.join(', ')}`,
  };
}

export async function logTelegramStartupDiagnostics() {
  syncBaseState();
  const config = getTelegramEnvConfig();
  const scriptPresent = isBridgeScriptPresent();

  console.log('[telegram] Startup config', {
    enabled: config.enabled,
    configured: config.configured,
    apiIdConfigured: Boolean(config.apiId),
    apiHashConfigured: Boolean(config.apiHash),
    sessionConfigured: Boolean(config.session),
    targetChat: config.targetChat,
    scriptPath: TELEGRAM_BRIDGE_SCRIPT,
    scriptPresent,
    pythonCandidates: PYTHON_CANDIDATES.map((s) => s.label),
    workingDirectory: process.cwd(),
  });

  if (!scriptPresent) {
    runtimeState.error = `Bridge script not found: ${TELEGRAM_BRIDGE_SCRIPT}`;
    runtimeState.code = 'SCRIPT_NOT_FOUND';
    console.warn(`[telegram] Bridge script not found at ${TELEGRAM_BRIDGE_SCRIPT}`);
    console.warn(`[telegram] Set TELEGRAM_BRIDGE_SCRIPT_PATH to override, or create the script at one of:`, TELEGRAM_CHECKED_SCRIPT_PATHS);
    return;
  }

  console.log(`[telegram] using script: ${TELEGRAM_BRIDGE_SCRIPT}`);
  console.log(`[telegram] target chat: ${config.targetChat ?? 'not set'}`);

  try {
    const doctor = await runScript<Record<string, unknown>>(['doctor'], 15_000);
    console.log('[telegram] Python bridge diagnostics', doctor);
    if (doctor.telethon_installed === false) {
      console.error('[telegram] Telethon is missing. Run: py -3.11 -m pip install --upgrade telethon');
    }
    if (doctor.python_telegram_bot_installed === false) {
      console.warn('[telegram] python-telegram-bot is missing. Run: py -3.11 -m pip install --upgrade python-telegram-bot');
    }
  } catch (err) {
    console.warn('[telegram] doctor check failed:', err instanceof Error ? err.message : String(err));
  }
}

export async function testTelegramConnection(): Promise<TelegramConnectionTestResult> {
  syncBaseState();
  const config = getTelegramEnvConfig();

  if (!config.enabled) {
    return _notConfiguredResult('Telegram is not configured.', 'MISSING_CREDENTIALS');
  }
  if (!config.configured) {
    return _notConfiguredResult(config.error ?? 'Telegram credentials incomplete.', 'MISSING_CREDENTIALS', true);
  }

  type TestResult = {
    ok: boolean;
    phase: string;
    authorized?: boolean;
    chatResolved?: boolean;
    chatId?: string;
    chatTitle?: string;
    username?: string;
    message?: string;
    code?: string;
  };

  try {
    const result = await runScript<TestResult>(['test'], 30_000);
    console.log(`[telegram] selected python: ${resolvedPythonSpec?.label ?? 'none'}`);
    console.log(`[telegram] target chat: ${config.targetChat ?? 'not set'}`);

    if (!result.ok) {
      const errCode = result.code ?? result.phase ?? 'TELEGRAM_UNAVAILABLE';
      runtimeState.connected = false;
      runtimeState.loggedIn = false;
      runtimeState.error = result.message ?? 'Connection failed.';
      runtimeState.code = errCode;
      runtimeState.currentPhase = result.phase ?? null;
      runtimeState.errorPhase = result.phase ?? null;
      return _failedResult(result.message ?? 'Connection failed.', errCode, result.phase ?? null);
    }

    runtimeState.connected = result.authorized === true;
    runtimeState.loggedIn = result.authorized === true;
    runtimeState.targetChatResolved = result.chatResolved === true;
    runtimeState.targetChatAccessible = result.chatResolved === true;
    runtimeState.canReadMessages = result.chatResolved === true;
    runtimeState.targetChatTitle = result.chatTitle ?? null;
    runtimeState.targetChat = result.chatId ?? config.targetChat;
    runtimeState.accountUsername = result.username ?? null;
    runtimeState.error = null;
    runtimeState.code = null;
    runtimeState.currentPhase = 'CONNECTED';
    runtimeState.errorPhase = null;

    return {
      enabled: true,
      connected: true,
      loggedIn: true,
      targetChatAccessible: result.chatResolved === true,
      targetChatResolved: result.chatResolved === true,
      canReadMessages: result.chatResolved === true,
      messagesFetched: 0,
      currentPhase: 'CONNECTED',
      lastMessageDate: null,
      account: result.username ? { id: null, username: result.username, displayName: result.username } : null,
      targetChat: result.chatResolved
        ? { id: result.chatId ?? null, title: result.chatTitle ?? null, type: null }
        : null,
      error: null,
      code: null,
      errorPhase: null,
      errorMessage: null,
      stack: null,
      hints: [],
    };
  } catch (err) {
    const bridgeErr = err instanceof TelegramBridgeError
      ? err
      : new TelegramBridgeError('TELEGRAM_UNAVAILABLE', err instanceof Error ? err.message : 'Connection test failed.');
    runtimeState.connected = false;
    runtimeState.loggedIn = false;
    runtimeState.error = bridgeErr.message;
    runtimeState.code = bridgeErr.code;
    runtimeState.currentPhase = bridgeErr.phase;
    runtimeState.errorPhase = bridgeErr.phase;
    return _failedResult(bridgeErr.message, bridgeErr.code, bridgeErr.phase);
  }
}

type FetchHistorySuccess = {
  ok: true;
  chat?: { id: string | null; title: string | null; type: string | null };
  messages?: TelegramBridgeMessagePayload[];
  messages_fetched?: number;
  loggedIn?: boolean;
  target_chat_resolved?: boolean;
  can_read_messages?: boolean;
  last_message_date?: string | null;
  hints?: string[] | null;
};

export async function fetchTelegramHistory(limit: number, _afterId?: string | null): Promise<FetchHistorySuccess> {
  syncBaseState();
  const config = getTelegramEnvConfig();
  const clampedLimit = Math.min(Math.max(limit, 1), 10);

  type FetchResult = {
    ok: boolean;
    phase?: string;
    chatId?: string;
    messagesFetched?: number;
    messages?: Array<{ messageId: string; text: string; sentAt: string }>;
    limitSignals?: TelegramLimitSignal[];
    limitSignalsFound?: number;
    message?: string;
    code?: string;
  };

  console.log('[telegram] starting sync');
  console.log(`[telegram] target chat: ${config.targetChat ?? 'not set'}`);

  const result = await runScript<FetchResult>(['fetch-latest'], 45_000);
  console.log(`[telegram] using python: ${resolvedPythonSpec?.label ?? 'none'}`);
  console.log(`[telegram] using script: ${TELEGRAM_BRIDGE_SCRIPT}`);

  if (!result.ok) {
    throw new TelegramBridgeError(
      result.code ?? result.phase ?? 'TELEGRAM_UNAVAILABLE',
      result.message ?? 'Fetch failed.',
      null,
      { phase: result.phase ?? null },
    );
  }

  const chatId = result.chatId ?? config.targetChat ?? '';
  const rawMsgs = result.messages ?? [];
  const msgCount = result.messagesFetched ?? rawMsgs.length;
  const lastDate = rawMsgs[0]?.sentAt ?? null;

  console.log(`[telegram] fetched latest messages count=${msgCount}`);
  console.log(`[telegram] limit signals found=${result.limitSignalsFound ?? 0}`);

  runtimeState.connected = true;
  runtimeState.loggedIn = true;
  runtimeState.targetChatResolved = true;
  runtimeState.targetChatAccessible = true;
  runtimeState.canReadMessages = true;
  runtimeState.messagesFetched = msgCount;
  runtimeState.lastMessageDate = lastDate;
  runtimeState.lastSyncAt = new Date().toISOString();
  runtimeState.error = null;
  runtimeState.code = null;
  runtimeState.currentPhase = 'CONNECTED';
  runtimeState.errorPhase = null;

  console.log('[telegram] sync completed');

  const messages: TelegramBridgeMessagePayload[] = rawMsgs.map((m) => ({
    telegramMessageId: m.messageId,
    chatId,
    chatTitle: null,
    senderId: null,
    senderName: null,
    text: m.text,
    rawText: m.text,
    replyInfo: null,
    telegramDate: m.sentAt,
    attachments: [],
  }));

  return {
    ok: true,
    chat: { id: chatId, title: null, type: null },
    messages,
    messages_fetched: msgCount,
    loggedIn: true,
    target_chat_resolved: true,
    can_read_messages: true,
    last_message_date: lastDate,
    hints: [],
  };
}

/** Fetch latest messages and return only the XAUUSD/GOLD limit signals. */
export async function fetchLatestLimitSignals(): Promise<TelegramLimitSignal[]> {
  type FetchResult = {
    ok: boolean;
    phase?: string;
    message?: string;
    code?: string;
    limitSignals?: TelegramLimitSignal[];
  };

  const result = await runScript<FetchResult>(['fetch-latest'], 45_000);
  if (!result.ok) {
    throw new TelegramBridgeError(
      result.code ?? result.phase ?? 'TELEGRAM_UNAVAILABLE',
      result.message ?? 'Fetch failed.',
      null,
      { phase: result.phase ?? null },
    );
  }
  return result.limitSignals ?? [];
}

// No-op: the persistent monitor process is removed. Syncing is handled by the
// scheduled syncTelegramSignals() calls via telegramSyncScheduler.service.ts.
export function startTelegramMonitoring(
  _onMessage: (message: TelegramBridgeMessagePayload) => Promise<void>,
): void {
  console.log('[telegram] persistent monitor disabled — using scheduled sync instead');
}

export function stopTelegramMonitoring(): void { /* no-op */ }

export async function runTelegramDoctor(): Promise<{
  python_found: boolean;
  python_version: string | null;
  python_executable: string | null;
  script_exists: boolean;
  script_path: string;
  env_vars: Record<string, boolean>;
  doctor: Record<string, unknown> | null;
  doctor_error: string | null;
  error_code: string | null;
  raw_stderr: string | null;
}> {
  const scriptExists = isBridgeScriptPresent();
  const envVarKeys = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'TELEGRAM_TARGET_CHAT', 'TELEGRAM_SESSION_FILE'];
  const envVars = Object.fromEntries(envVarKeys.map((k) => [k, Boolean(process.env[k]?.trim())]));

  let pythonFound = false;
  let pythonVersion: string | null = null;
  let pythonExecutable: string | null = null;

  for (const spec of PYTHON_CANDIDATES) {
    const r = spawnSync(spec.cmd, [...spec.cmdArgs, '--version'], { encoding: 'utf8', timeout: 5000 });
    if (r.error == null && r.status === 0) {
      pythonFound = true;
      pythonVersion = (r.stdout || r.stderr || '').trim().split('\n')[0] ?? null;
      pythonExecutable = spec.label;
      break;
    }
  }

  if (!pythonFound || !scriptExists) {
    return {
      python_found: pythonFound,
      python_version: pythonVersion,
      python_executable: pythonExecutable,
      script_exists: scriptExists,
      script_path: TELEGRAM_BRIDGE_SCRIPT,
      env_vars: envVars,
      doctor: null,
      doctor_error: pythonFound ? 'Bridge script not found' : 'Python not found',
      error_code: pythonFound ? 'SCRIPT_NOT_FOUND' : 'PYTHON_NOT_FOUND',
      raw_stderr: null,
    };
  }

  try {
    const raw = await spawnScript(
      PYTHON_CANDIDATES.find((s) => {
        const r = spawnSync(s.cmd, [...s.cmdArgs, '--version'], { encoding: 'utf8', timeout: 3000 });
        return r.error == null && r.status === 0;
      }) ?? { cmd: 'python3', cmdArgs: [], label: 'python3' },
      ['doctor'],
      15_000,
    );
    const doctor = parseLastJsonLine<Record<string, unknown>>(raw);
    return { python_found: true, python_version: pythonVersion, python_executable: pythonExecutable, script_exists: true, script_path: TELEGRAM_BRIDGE_SCRIPT, env_vars: envVars, doctor, doctor_error: null, error_code: null, raw_stderr: null };
  } catch (err) {
    const bridgeErr = err instanceof TelegramBridgeError ? err : null;
    return { python_found: true, python_version: pythonVersion, python_executable: pythonExecutable, script_exists: true, script_path: TELEGRAM_BRIDGE_SCRIPT, env_vars: envVars, doctor: null, doctor_error: err instanceof Error ? err.message : String(err), error_code: bridgeErr?.code ?? 'DOCTOR_FAILED', raw_stderr: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private result builders
// ─────────────────────────────────────────────────────────────────────────────

function _notConfiguredResult(
  errorMsg: string | null,
  code: string,
  enabled = false,
): TelegramConnectionTestResult {
  return {
    enabled,
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
    error: errorMsg,
    code,
    errorPhase: 'load_session',
    errorMessage: errorMsg,
    stack: null,
    hints: ['Configure TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION, and TELEGRAM_TARGET_CHAT.'],
  };
}

function _failedResult(
  message: string,
  code: string,
  phase: string | null,
): TelegramConnectionTestResult {
  return {
    enabled: true,
    connected: false,
    loggedIn: false,
    targetChatAccessible: false,
    targetChatResolved: false,
    canReadMessages: false,
    messagesFetched: 0,
    currentPhase: phase,
    lastMessageDate: null,
    account: null,
    targetChat: null,
    error: message,
    code,
    errorPhase: phase,
    errorMessage: message,
    stack: null,
    hints: [],
  };
}
