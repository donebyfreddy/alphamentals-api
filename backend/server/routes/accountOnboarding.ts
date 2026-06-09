import { Router } from 'express';
import { z } from 'zod';
import { connectMetaTrader, getBridgeStatus, type MetaTraderConnectResult } from '../services/metaTrader.service.js';
import { mt5BridgeClient } from '../lib/mt5BridgeClient.js';

export const accountOnboardingRouter = Router();

const serviceStateSchema = z.enum(['connected', 'connecting', 'error', 'disconnected', 'unavailable']);

const connectExistingSchema = z.object({
  broker: z.string().trim().min(1),
  platform: z.literal('MT5'),
  login: z.string().trim().min(1),
  password: z.string().min(1),
  server: z.string().trim().min(1),
});

const createDemoSchema = z.object({
  broker: z.enum(['Admirals', 'XM', 'ActivTrades', 'Tickmill', 'Pepperstone', 'IC Markets', 'FP Markets', 'Eightcap']),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email(),
  country: z.string().trim().min(1),
  leverage: z.string().trim().min(1),
  startingBalance: z.number().positive().optional(),
});

type OnboardingServiceStatus = {
  state: z.infer<typeof serviceStateSchema>;
  label: string;
  message?: string;
  updatedAt: string | null;
};

type OnboardingProcessStep = {
  key: string;
  label: string;
  status: 'pending' | 'completed' | 'failed';
  detail?: string;
};

function serviceStatus(params: {
  state: OnboardingServiceStatus['state'];
  label: string;
  message?: string;
  updatedAt?: string | null;
}): OnboardingServiceStatus {
  return {
    state: params.state,
    label: params.label,
    message: params.message,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
  };
}

async function getQuoteFeedStatus() {
  if (!mt5BridgeClient.isConfigured()) {
    return serviceStatus({
      state: 'unavailable',
      label: 'Quotes Not Updating',
      message: 'MT5 bridge quote feed is not configured.',
    });
  }

  try {
    await mt5BridgeClient.get('/quotes?symbols=XAUUSD');
    return serviceStatus({
      state: 'connected',
      label: 'Quotes Streaming',
      message: 'MT5 bridge quote feed responded successfully.',
    });
  } catch (error) {
    return serviceStatus({
      state: 'error',
      label: 'Quotes Not Updating',
      message: error instanceof Error ? error.message : 'Failed to reach MT5 bridge quote feed.',
    });
  }
}

function bridgeServiceStatus(now: string) {
  const bridge = getBridgeStatus();
  if (bridge.ready) {
    return serviceStatus({
      state: 'connected',
      label: 'Bridge Connected',
      message: bridge.message,
      updatedAt: now,
    });
  }

  return serviceStatus({
    state: 'error',
    label: 'Bridge Disconnected',
    message: bridge.message,
    updatedAt: now,
  });
}

function metaApiServiceStatus(result: MetaTraderConnectResult, now: string) {
  if (result.success) {
    return serviceStatus({
      state: 'connected',
      label: 'MetaApi Connected',
      message: 'MetaApi account deployment and terminal connectivity succeeded.',
      updatedAt: now,
    });
  }

  return serviceStatus({
    state: 'error',
    label: 'MetaApi Error',
    message: result.error?.message ?? 'MetaApi onboarding failed.',
    updatedAt: now,
  });
}

function heartbeatServiceStatus(success: boolean, now: string, message?: string) {
  return serviceStatus({
    state: success ? 'connected' : 'error',
    label: success ? 'Heartbeat Active' : 'Heartbeat Missing',
    message: success ? 'Account synchronization heartbeat started.' : (message ?? 'Account synchronization heartbeat could not be started.'),
    updatedAt: now,
  });
}

function buildExistingAccountProcessSteps(params: {
  success: boolean;
  connectResult: MetaTraderConnectResult;
  quoteFeed: OnboardingServiceStatus;
}) {
  const errorDetail = params.connectResult.error?.message;

  const steps: OnboardingProcessStep[] = [
    { key: 'credentials', label: 'Credentials sent securely to VPS', status: 'completed' },
    {
      key: 'metaapi',
      label: 'VPS creates or connects a MetaApi account',
      status: params.success ? 'completed' : 'failed',
      detail: params.success ? 'MetaApi account is ready.' : errorDetail,
    },
    {
      key: 'bridge',
      label: 'VPS deploys the MT5 bridge connection',
      status: params.success ? 'completed' : 'failed',
      detail: params.success ? 'Bridge connection deployed.' : errorDetail,
    },
    {
      key: 'terminal',
      label: 'VPS verifies terminal connection',
      status: params.success ? 'completed' : 'failed',
      detail: params.success ? 'Broker terminal responded successfully.' : errorDetail,
    },
    {
      key: 'sync',
      label: 'VPS starts account synchronization',
      status: params.success ? 'completed' : 'failed',
      detail: params.success ? 'Open positions and history loaded.' : errorDetail,
    },
    {
      key: 'journal',
      label: 'VPS enables auto-journaling',
      status: params.success ? 'completed' : 'pending',
      detail: params.success ? 'Auto-journaling can begin immediately.' : 'Will be enabled after a successful connection.',
    },
    {
      key: 'quotes',
      label: 'VPS validates quote feed',
      status: params.quoteFeed.state === 'connected' ? 'completed' : 'failed',
      detail: params.quoteFeed.message,
    },
  ];

  return steps;
}

accountOnboardingRouter.post('/mt5/connect-existing', async (req, res) => {
  const parsed = connectExistingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid existing account onboarding payload.',
      errors: parsed.error.flatten(),
    });
    return;
  }

  const now = new Date().toISOString();
  const connectResult = await connectMetaTrader({
    version: 'mt5',
    server: parsed.data.server,
    login: parsed.data.login,
    password: parsed.data.password,
    accountType: 'live',
    passwordType: 'master',
  });
  const quoteFeed = await getQuoteFeedStatus();
  const bridgeStatus = bridgeServiceStatus(now);
  const metaApiStatus = metaApiServiceStatus(connectResult, now);
  const heartbeatStatus = heartbeatServiceStatus(connectResult.success, now, connectResult.error?.message);
  const process = buildExistingAccountProcessSteps({
    success: connectResult.success,
    connectResult,
    quoteFeed,
  });

  if (!connectResult.success || !connectResult.account) {
    res.status(400).json({
      success: false,
      status: 'error',
      message: connectResult.error?.message ?? 'Failed to connect the MT5 account.',
      process,
      diagnostics: {
        bridgeStatus,
        metaApiStatus,
        quoteFeedStatus: quoteFeed,
        heartbeatStatus,
      },
      autoHealingEnabled: true,
      lastSyncTime: null,
    });
    return;
  }

  const account = connectResult.account;
  res.json({
    success: true,
    status: 'connected',
    message: 'Trading account connected and synchronized successfully.',
    process,
    account: {
      broker: parsed.data.broker || account.broker,
      platform: 'MT5',
      server: account.server,
      login: account.login,
      balance: account.balance,
      equity: account.equity,
      margin: null,
      freeMargin: null,
      leverage: account.leverage,
      accountNumber: account.login,
      connectedTime: now,
      openPositions: connectResult.positions?.length ?? 0,
      closedTrades: connectResult.history?.filter((deal) => deal.entryType === 1 || deal.entryType == null).length ?? 0,
    },
    diagnostics: {
      bridgeStatus,
      metaApiStatus,
      quoteFeedStatus: quoteFeed,
      heartbeatStatus,
    },
    lastSyncTime: now,
    autoHealingEnabled: true,
    connectionKey: connectResult.connectionKey,
    importedHistoryCount: connectResult.history?.length ?? 0,
  });
});

accountOnboardingRouter.post('/mt5/create-demo', async (req, res) => {
  const parsed = createDemoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid demo account onboarding payload.',
      errors: parsed.error.flatten(),
    });
    return;
  }

  const automationBaseUrl = process.env.MT5_VPS_AUTOMATION_URL?.replace(/\/$/, '') ?? '';
  const automationApiKey = process.env.MT5_VPS_AUTOMATION_API_KEY ?? '';

  if (!automationBaseUrl) {
    res.status(503).json({
      success: false,
      status: 'error',
      message: 'Demo account provisioning is not configured on the VPS yet. Set MT5_VPS_AUTOMATION_URL to enable broker demo creation.',
      process: [
        { key: 'request', label: 'Request sent to VPS', status: 'failed', detail: 'MT5_VPS_AUTOMATION_URL is missing.' },
        { key: 'provision', label: 'VPS creates MT5 demo account', status: 'pending' },
        { key: 'bridge', label: 'VPS installs and configures bridge connection', status: 'pending' },
        { key: 'sync', label: 'VPS attaches synchronization and journaling', status: 'pending' },
      ],
      diagnostics: {
        bridgeStatus: bridgeServiceStatus(new Date().toISOString()),
        metaApiStatus: serviceStatus({ state: 'unavailable', label: 'MetaApi Unavailable', message: 'Demo broker onboarding endpoint is not configured.' }),
        quoteFeedStatus: await getQuoteFeedStatus(),
        heartbeatStatus: serviceStatus({ state: 'unavailable', label: 'Heartbeat Missing', message: 'No demo account heartbeat until provisioning is configured.' }),
      },
      autoHealingEnabled: true,
    });
    return;
  }

  try {
    const response = await fetch(`${automationBaseUrl}/demo-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(automationApiKey ? { 'x-api-key': automationApiKey } : {}),
      },
      body: JSON.stringify(parsed.data),
    });

    const bodyText = await response.text();
    const payload = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};

    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        status: 'error',
        message: typeof payload.message === 'string' ? payload.message : `Demo account provisioning failed with HTTP ${response.status}.`,
        process: payload.process ?? [],
        diagnostics: payload.diagnostics ?? null,
        raw: payload,
      });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(502).json({
      success: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to reach VPS automation service.',
      process: [
        { key: 'request', label: 'Request sent to VPS', status: 'failed', detail: error instanceof Error ? error.message : 'Network error' },
      ],
      diagnostics: {
        bridgeStatus: bridgeServiceStatus(new Date().toISOString()),
        metaApiStatus: serviceStatus({ state: 'error', label: 'MetaApi Error', message: 'Failed to reach the VPS automation service.' }),
        quoteFeedStatus: await getQuoteFeedStatus(),
        heartbeatStatus: serviceStatus({ state: 'error', label: 'Heartbeat Missing', message: 'No provisioning heartbeat was returned.' }),
      },
      autoHealingEnabled: true,
    });
  }
});
