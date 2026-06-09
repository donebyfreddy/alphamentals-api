import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { marketDataRouter } from '../server/routes/marketData.js';
import { aiInsightsRouter } from '../server/routes/aiInsights.js';
import { economicCalendarRouter } from '../server/routes/economicCalendar.js';
import { macroDataRouter } from '../server/routes/macroData.js';
import { forexRatesRouter } from '../server/routes/forexRates.js';
import journalRouter from '../server/routes/journal.js';
import analyticsRouter from '../server/routes/analytics.js';
import coachRouter from '../server/routes/coach.js';
import checklistRouter from '../server/routes/checklist.js';
import riskManagerRouter from '../server/routes/riskManager.js';
import { fundamentalsRouter } from '../server/routes/fundamentals.js';
import { pairsRouter } from '../server/routes/pairs.js';
import { tradingviewWebhookRouter } from '../server/routes/tradingviewWebhook.js';
import { telegramRouter } from '../server/routes/telegram.js';
import { mt5Router, tradesRouter } from '../server/routes/mt5.js';
import { mt5BridgeRouter } from '../server/routes/mt5Bridge.js';
import { getTelegramRuntimeState } from '../server/services/telegramBridge.service.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/market-data', marketDataRouter);
app.use('/api/ai-insights', aiInsightsRouter);
app.use('/api/economic-calendar', economicCalendarRouter);
app.use('/api/macro', macroDataRouter);
app.use('/api/forex-rates', forexRatesRouter);
app.use('/api/journal', journalRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/coach', coachRouter);
app.use('/api/checklist', checklistRouter);
app.use('/api/risk', riskManagerRouter);
app.use('/api/fundamentals', fundamentalsRouter);
app.use('/api/pairs', pairsRouter);
app.use('/api/tradingview-webhook', tradingviewWebhookRouter);
app.use('/api/telegram', telegramRouter);
app.use('/telegram', telegramRouter);
app.use('/api/mt5', mt5Router);
app.use('/api/mt5-bridge', mt5BridgeRouter);
app.use('/api/trades', tradesRouter);

function sendHealth(_req: express.Request, res: express.Response) {
  const telegram = getTelegramRuntimeState();
  res.json({
    status: 'ok',
    telegram: {
      enabled: telegram.enabled,
      connected: telegram.connected,
      target_chat_accessible: telegram.targetChatAccessible,
    },
  });
}

app.get('/api/health', sendHealth);
app.get('/health', sendHealth);

export default app;
