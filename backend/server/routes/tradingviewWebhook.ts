import { Router } from 'express';
import { listRecentTradingviewAlerts, processTradingviewWebhook } from '../services/tradingviewBridge.service.js';
import type { RawTradingviewPayload, TradingviewAlertRecord } from '../types/tradingview.js';

export const tradingviewWebhookRouter = Router();

function toWebhookResponse(record: TradingviewAlertRecord, status: 'processed' | 'duplicate' = 'processed') {
  const analysis = record.analysis;
  const entry =
    analysis && analysis.entry_zone.low > 0 && analysis.entry_zone.high > 0
      ? Number(((analysis.entry_zone.low + analysis.entry_zone.high) / 2).toFixed(record.symbol === 'XAUUSD' ? 2 : 5))
      : null;

  return {
    status,
    recordId: record.id,
    action: analysis?.decision === 'BUY' || analysis?.decision === 'SELL' ? 'TRADE' : 'NO_TRADE',
    tradeDirection: analysis?.decision ?? 'NO_TRADE',
    bias: analysis?.bias === 'neutral' || !analysis?.bias ? 'mixed' : analysis.bias,
    confidence: analysis?.confidence ?? 0,
    entry,
    stopLoss: analysis?.stop_loss || null,
    takeProfit: analysis?.take_profit_1 || null,
    takeProfitSecondary: analysis?.take_profit_2 || null,
    reason: analysis?.reasoning.join(' ') ?? record.error ?? 'No analysis returned.',
    riskNotes: [...(analysis?.warnings ?? []), ...(analysis?.invalid_if ?? [])],
    analysis,
    context: record.context,
    notifications: record.notifications,
  };
}

tradingviewWebhookRouter.post('/', async (req, res) => {
  try {
    const payload = req.body as RawTradingviewPayload;
    const result = await processTradingviewWebhook(payload);

    if (result.duplicate) {
      return res.status(409).json({
        ...toWebhookResponse(result.record, 'duplicate'),
        message: 'Duplicate alert rejected within configured window',
      });
    }

    return res.json(toWebhookResponse(result.record));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown TradingView webhook error';
    const status = message.toLowerCase().includes('secret') ? 401 : 400;
    return res.status(status).json({ error: message });
  }
});

tradingviewWebhookRouter.get('/recent', async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  const records = await listRecentTradingviewAlerts(Number.isFinite(limit) ? Math.min(limit, 100) : 30);
  res.json(records);
});
