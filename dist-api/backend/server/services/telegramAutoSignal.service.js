"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailForMessage = sendEmailForMessage;
exports.handleNewTelegramSignal = handleNewTelegramSignal;
const notification_service_js_1 = require("./notification.service.js");
const mailer_js_1 = require("../lib/mailer.js");
const telegramMessageStore_service_js_1 = require("./telegramMessageStore.service.js");
const telegramSignalAnalyze_service_js_1 = require("./telegramSignalAnalyze.service.js");
const TELEGRAM_ALERT_RECIPIENT = 'fo.mencuccini@gmail.com';
const AUTO_SIGNAL_TIMEOUT_MS = 120_000;
function supportedAutoSignal(message) {
    return (message.messageType === 'SIGNAL' &&
        Boolean(message.symbol) &&
        (message.direction === 'BUY' || message.direction === 'SELL') &&
        Boolean(message.entry) &&
        Boolean(message.stopLoss));
}
function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Automatic Telegram signal workflow timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}
function computeEmailSubject(result) {
    return `[${result.decisionLabel}] ${result.symbol} ${result.parsedSignal.orderType ?? 'MARKET'} — Trade Quality ${result.tradeQualityScore}/100 — ${result.rejectionCategory}`;
}
function appBaseUrl() {
    const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    if (explicit?.trim())
        return explicit.replace(/\/+$/, '');
    if (process.env.VERCEL_URL?.trim())
        return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    return null;
}
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function formatDateGmt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return null;
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
        timeZoneName: 'short',
    }).format(date).replace(',', '');
}
function formatNumber(value) {
    if (value == null || !Number.isFinite(value))
        return null;
    if (Math.abs(value) >= 1000)
        return value.toFixed(2);
    if (Math.abs(value) >= 10)
        return value.toFixed(3).replace(/\.?0+$/, '');
    return value.toFixed(5).replace(/\.?0+$/, '');
}
function titleCase(value) {
    if (!value)
        return null;
    return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
function decisionLabel(result) {
    if (result.verdict === 'GOOD')
        return { text: 'APPROVED', emoji: '🟢', color: '#34d399', bg: '#052e24', border: '#10b981' };
    if (result.verdict === 'BAD')
        return { text: 'REJECTED', emoji: '🔴', color: '#f87171', bg: '#3f1218', border: '#ef4444' };
    if (result.verdict === 'RISKY')
        return { text: 'RISKY', emoji: '🟠', color: '#fb923c', bg: '#431407', border: '#f97316' };
    return { text: 'MONITOR', emoji: '🟡', color: '#fde047', bg: '#3a2f08', border: '#eab308' };
}
function actionLabel(result) {
    if (result.finalAction === 'take')
        return 'APPROVED';
    if (result.finalAction === 'avoid')
        return 'REJECTED';
    return 'MONITOR';
}
function statusChip(label, tone = 'blue') {
    if (!label)
        return '';
    const colors = {
        green: ['#064e3b', '#34d399', '#10b981'],
        yellow: ['#3a2f08', '#fde047', '#eab308'],
        red: ['#3f1218', '#f87171', '#ef4444'],
        blue: ['#0f2544', '#93c5fd', '#3b82f6'],
    }[tone];
    return `<span style="display:inline-block;margin:4px 6px 0 0;padding:6px 9px;border-radius:999px;background:${colors[0]};border:1px solid ${colors[2]};color:${colors[1]};font-size:12px;font-weight:700;">${escapeHtml(label)}</span>`;
}
function statusTone(value) {
    const normalized = String(value ?? '').toLowerCase();
    if (['good', 'approved', 'aligned', 'normal', 'low', 'safe', 'healthy'].includes(normalized))
        return 'green';
    if (['high', 'extreme', 'against', 'avoid', 'bad', 'rejected'].includes(normalized))
        return 'red';
    return 'yellow';
}
function metric(label, value, icon = '') {
    if (value == null || value === '')
        return '';
    return `
    <td style="width:50%;padding:8px;">
      <div style="min-height:58px;padding:12px;border:1px solid #223044;border-radius:10px;background:#0d1522;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8ea0b8;">${icon} ${escapeHtml(label)}</div>
        <div style="margin-top:6px;font-size:18px;line-height:1.2;color:#f8fafc;font-weight:800;">${escapeHtml(value)}</div>
      </div>
    </td>
  `;
}
function metricGrid(items) {
    const cells = items.map(([label, value, icon]) => metric(label, value, icon)).filter(Boolean);
    const rows = [];
    for (let i = 0; i < cells.length; i += 2) {
        rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td style="width:50%;padding:8px;"></td>'}</tr>`);
    }
    return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:-8px;">${rows.join('')}</table>`;
}
function bulletList(items, icon = '•') {
    const clean = items.filter(Boolean).slice(0, 5);
    if (!clean.length)
        return '';
    return clean.map((item) => `
    <div style="margin:7px 0;color:#dbe4f0;font-size:14px;line-height:1.35;">
      <span style="color:#93c5fd;font-weight:800;">${icon}</span>
      <span>${escapeHtml(item)}</span>
    </div>
  `).join('');
}
function splitReasoning(text) {
    return text
        .split(/(?:\n|\. |; )+/)
        .map((item) => item.trim().replace(/\.$/, ''))
        .filter((item) => item.length > 8)
        .slice(0, 3);
}
function buildReasoningGroups(result) {
    const positives = [
        ...result.keyReasons,
        ...splitReasoning(result.summary),
    ].slice(0, 5);
    const concerns = [
        ...result.keyRisks,
        ...(result.rr?.tp1Ratio != null && result.rr.tp1Ratio < 1 ? ['TP1 RR below minimum threshold'] : []),
        ...(result.technicalContext.spreadStatus === 'high' ? ['Spread currently elevated'] : []),
        ...(result.technicalContext.volatility === 'extreme' ? ['Volatility is extreme'] : []),
    ].slice(0, 5);
    const conflicts = [
        result.technicalAlignment !== 'aligned' && result.fundamentalAlignment !== 'aligned'
            ? 'Technical and fundamental signals are not fully aligned'
            : '',
        result.fundamentalAlignment === 'against' ? 'Macro bias conflicts with the signal direction' : '',
        result.technicalAlignment === 'against' ? 'Technical structure conflicts with the signal direction' : '',
    ].filter(Boolean).slice(0, 5);
    return { positives, concerns, conflicts };
}
function scoreBar(value) {
    if (value == null || !Number.isFinite(value))
        return '';
    const filled = Math.max(0, Math.min(10, Math.round(value / 10)));
    const empty = 10 - filled;
    const color = value >= 70 ? '#34d399' : value >= 50 ? '#facc15' : '#f87171';
    return `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${color};letter-spacing:1px;">${'█'.repeat(filled)}${'░'.repeat(empty)}</span> <strong style="color:#f8fafc;">${value}%</strong>`;
}
function confluenceRows(result) {
    const c = result.confluence;
    if (!c)
        return '';
    return [
        ['Technical Alignment', c.technicalAlignment],
        ['Fundamental Alignment', c.fundamentalAlignment],
        ['Risk/Reward Quality', c.riskRewardQuality],
        ['Execution Conditions', c.executionConditions],
        ['Overall Confluence', c.overall],
    ].map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin:9px 0;font-size:13px;">
      <span style="color:#a9b8cd;">${label}</span>
      <span>${scoreBar(value)}</span>
    </div>
  `).join('');
}
function rrChips(result) {
    if (!result.rr?.targets.length)
        return '';
    return result.rr.targets.map((target) => {
        const tone = target.ratio >= 1.5 ? 'green' : target.ratio >= 1 ? 'yellow' : 'red';
        return statusChip(`TP${target.targetIndex} ${target.ratio >= 1.5 ? '🟩' : '🟥'} ${target.ratio}`, tone);
    }).join('');
}
function section(title, body, accent = '#1f2937') {
    if (!body.trim())
        return '';
    return `
    <div style="margin-top:14px;padding:16px;border:1px solid ${accent};border-radius:14px;background:#101827;">
      <div style="margin:0 0 12px;color:#f8fafc;font-size:14px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${title}</div>
      ${body}
    </div>
  `;
}
function buildTelegramSignalEmail(message, result) {
    const linkBase = appBaseUrl();
    const telegramInfoLink = linkBase ? `${linkBase}/telegram-info` : null;
    const fundamentalsLink = linkBase && result.symbol ? `${linkBase}/market-intelligence/fundamentals/${encodeURIComponent(result.symbol)}` : null;
    const pairLink = linkBase && result.symbol ? `${linkBase}/pair/${encodeURIComponent(result.symbol)}` : null;
    const decision = decisionLabel(result);
    const receivedAt = formatDateGmt(message.telegramDate);
    const action = actionLabel(result);
    const fundamentals = result.fundamentalsContext;
    const source = message.chatTitle ?? message.chatId;
    const html = `
    <div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;padding:18px;background:#070b12;color:#e5edf7;">
      <div style="border:1px solid #1f2a3a;border-radius:18px;overflow:hidden;background:#0a101a;">
        <div style="padding:22px 20px;background:#0b1220;border-bottom:1px solid #1f2a3a;">
          <div style="font-size:12px;color:#8ea0b8;letter-spacing:.14em;text-transform:uppercase;font-weight:800;">Telegram Trade Validation Report</div>
          <div style="margin-top:8px;font-size:28px;line-height:1.1;font-weight:950;color:#f8fafc;">${decision.emoji} ${escapeHtml(result.symbol)} ${escapeHtml(result.parsedSignal.direction)} ${escapeHtml(result.parsedSignal.orderType ?? 'MARKET')}</div>
          <div style="margin-top:10px;color:#b9c7d9;font-size:14px;">${escapeHtml(source)}${receivedAt ? ` · ${escapeHtml(receivedAt)}` : ''}</div>
          <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;">
            ${statusChip(`Verdict ${result.verdict}`, result.verdict === 'BAD' ? 'red' : result.verdict === 'GOOD' ? 'green' : 'yellow')}
            ${statusChip(`Decision ${result.decisionLabel}`, result.decisionLabel === 'REJECTED' ? 'red' : result.decisionLabel === 'ACCEPTED' ? 'green' : 'yellow')}
            ${statusChip(`Category ${result.rejectionCategory}`, result.rejectionCategory === 'NONE' ? 'green' : 'red')}
            ${statusChip(`Trade Quality ${result.tradeQualityScore}/100`, result.tradeQualityScore >= 70 ? 'green' : result.tradeQualityScore >= 45 ? 'yellow' : 'red')}
            ${statusChip(`Execution ${result.executionValidityScore}/100`, result.executionValidityScore >= 70 ? 'green' : result.executionValidityScore >= 45 ? 'yellow' : 'red')}
          </div>
        </div>

        <div style="padding:18px;">
          ${section('1. Header', metricGrid([
        ['Direction', result.parsedSignal.direction, '🧭'],
        ['Order Type', result.parsedSignal.orderType ?? 'MARKET', '📌'],
        ['AI Verdict Confidence', `${result.aiVerdictConfidence}%`, '🤖'],
        ['Rejection Confidence', `${result.rejectionConfidence}%`, '🛡️'],
    ]), '#2b3b54')}

          ${section('2. Signal Summary', metricGrid([
        ['Entry', formatNumber(result.parsedSignal.entry), '🎯'],
        ['Stop Loss', formatNumber(result.parsedSignal.sl), '🛑'],
        ['Take Profits', result.parsedSignal.tps.map(formatNumber).filter(Boolean).map((tp, index) => `TP${index + 1} ${tp}`).join(' · '), '💰'],
        ['Current Price', formatNumber(result.technicalContext.currentPrice), '💲'],
        ['Signal Time', message.telegramDate, '🕒'],
        ['Analysis Time', result.usedAnalysisGeneratedAt ?? result.technicalContext.lastUpdated ?? 'n/a', '⏱️'],
        ['Signal Age', result.executionValidity.signalAge, '⌛'],
        ['Freshness', result.executionValidity.freshnessStatus, '🧪'],
    ]), '#2b3b54')}

          ${section('3. Hard Validation Checks', bulletList([
        `Order Type Validity: ${result.executionValidity.orderTypeAssessment}`,
        `Current Price vs Entry: ${result.executionValidity.currentPriceVsEntry}`,
        `Current Price vs SL: ${result.executionValidity.currentPriceVsStopLoss}`,
        `Already Invalidated: ${result.executionValidity.alreadyInvalidated ? 'Yes' : 'No'}`,
        `Entry Distance: ${result.executionValidity.entryDistance}`,
        `Entry Distance in R: ${result.executionValidity.entryDistanceR ?? 'unavailable'}`,
        `Execution Conditions: ${result.executionValidity.executionAssessment}`,
    ]), '#7f1d1d')}

          ${section('4. Risk / Reward', `
            ${metricGrid([
        ['Risk Size', formatNumber(result.riskReward.riskSize), '⚖️'],
        ['Overall RR Quality', result.riskReward.overallQuality, '📈'],
    ])}
            ${bulletList(result.riskReward.tpAssessments.map((tp) => `${tp.tp}: ${tp.rr ?? 'n/a'}R · ${tp.quality} · ${tp.comment}`))}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;line-height:1.4;">${escapeHtml(result.riskReward.assessment)}</div>
          `, '#2b3b54')}

          ${section('5. Technical Pair Analysis', `
            ${metricGrid([
        ['Source', result.technicalContext.sourcePath, '📉'],
        ['Last Updated', result.technicalContext.lastUpdated ?? 'unknown', '🕒'],
        ['Trend', result.technicalContext.trend, '📊'],
        ['Market Structure', result.technicalContext.marketStructure ?? 'unavailable', '🏗️'],
        ['Technical Score', result.technicalContext.technicalScore != null ? `${result.technicalContext.technicalScore}/100` : 'unavailable', '🎯'],
        ['Support', formatNumber(result.technicalContext.support), '🧱'],
        ['Resistance', formatNumber(result.technicalContext.resistance), '🚧'],
        ['Entry Location', result.technicalContext.entryLocationQuality, '📍'],
    ])}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">Liquidity Context: ${escapeHtml(result.technicalContext.liquidityContext)}</div>
            ${result.technicalContext.confirmationNeeded.length ? `<div style="margin-top:10px;color:#f8fafc;font-weight:800;">Confirmation Needed</div>${bulletList(result.technicalContext.confirmationNeeded)}` : ''}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">${escapeHtml(result.technicalContext.assessment)}</div>
          `, '#253145')}

          ${section('6. Fundamental Intelligence', `
            ${metricGrid([
        ['Source', result.fundamentalContext.sourcePath, '📰'],
        ['Last Updated', result.fundamentalContext.lastUpdated ?? 'unknown', '🕒'],
        ['Macro Bias', `${result.fundamentalContext.macroBias}${result.fundamentalContext.macroConfidence != null ? ` (${result.fundamentalContext.macroConfidence}%)` : ''}`, '🌍'],
        ['Calendar Risk', result.newsAndSessionRisk.calendarRisk, '📅'],
    ])}
            ${result.fundamentalContext.keyDrivers.length ? `<div style="margin-top:10px;color:#f8fafc;font-weight:800;">Key Drivers</div>${bulletList(result.fundamentalContext.keyDrivers)}` : '<div style="margin-top:10px;color:#fca5a5;">Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.</div>'}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">${escapeHtml(result.fundamentalContext.assessment)}</div>
          `, '#263a2f')}

          ${section('7. News / Session / Volatility', bulletList([
        `Calendar Risk: ${result.newsAndSessionRisk.calendarRisk}`,
        `Headline Risk: ${result.newsAndSessionRisk.headlineRisk}`,
        `Session: ${result.newsAndSessionRisk.session}`,
        `Liquidity Quality: ${result.newsAndSessionRisk.liquidityQuality}`,
        `Spread Status: ${result.newsAndSessionRisk.spreadStatus}`,
        `Volatility: ${result.newsAndSessionRisk.volatility}`,
        `Assessment: ${result.newsAndSessionRisk.assessment}`,
    ]), '#5a4218')}

          ${section('8. Conflicts', bulletList(result.conflicts.length ? result.conflicts : ['No major conflicts detected beyond the sections above.']), '#7f1d1d')}

          ${section('9. Final Verdict', `
            <div style="display:inline-block;padding:12px 16px;border-radius:14px;background:${decision.bg};border:1px solid ${decision.border};color:${decision.color};font-size:22px;font-weight:950;">${decision.emoji} ${escapeHtml(result.decisionLabel)}</div>
            <div style="margin-top:12px;color:#dbe4f0;font-size:14px;"><strong>Primary Reason:</strong> ${escapeHtml(result.primaryReason)}</div>
            ${result.hardRejectionReasons.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Hard Rejection Reasons</div>${bulletList(result.hardRejectionReasons)}` : ''}
            ${result.softConcerns.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Soft Concerns</div>${bulletList(result.softConcerns)}` : ''}
            ${result.positiveFactors.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Positive Factors</div>${bulletList(result.positiveFactors)}` : ''}
            <div style="margin-top:12px;color:#dbe4f0;font-size:14px;"><strong>Recommended Action:</strong> ${escapeHtml(result.recommendedAction)}</div>
          `, '#293c5a')}

          ${section('10. What Would Make This Trade Valid', bulletList(result.whatWouldMakeItValid.length ? result.whatWouldMakeItValid : ['No specific path to validity was identified for this setup.']), '#1f513f')}

          ${section('11. Trader Checklist', result.checklist.map((item) => `
            <div style="margin:8px 0;padding:10px 12px;border:1px solid #243041;border-radius:10px;background:#0d1522;">
              <div style="font-size:13px;font-weight:800;color:#f8fafc;">${escapeHtml(item.item)} <span style="color:#8ea0b8;">(${escapeHtml(item.status)})</span></div>
              <div style="margin-top:4px;font-size:13px;color:#dbe4f0;">${escapeHtml(item.details)}</div>
            </div>
          `).join(''), '#2d3344')}

          ${result.aiValidationUnavailable ? `
            <div style="margin-top:14px;padding:14px;border:1px solid #7c2d12;border-radius:12px;background:#431407;color:#fed7aa;">
              <strong>AI validation unavailable</strong>
              <div style="margin-top:6px;">${escapeHtml(result.aiValidationError ?? 'The AI validation step failed.')}</div>
            </div>
          ` : ''}

          ${section('12. Source Message', `<div style="color:#cbd5e1;font-size:13px;line-height:1.45;white-space:pre-wrap;">${escapeHtml(message.rawText.slice(0, 1200))}${message.rawText.length > 1200 ? '...' : ''}</div>`, '#1f2937')}

          ${(telegramInfoLink || fundamentalsLink || pairLink) ? `
            <div style="margin-top:16px;">
              ${telegramInfoLink ? `<a href="${telegramInfoLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#1d4ed8;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">📡 Telegram Info</a>` : ''}
              ${fundamentalsLink ? `<a href="${fundamentalsLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#047857;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">📰 Fundamentals</a>` : ''}
              ${pairLink ? `<a href="${pairLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#334155;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">📉 Pair Page</a>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
    const text = [
        `${decision.emoji} ${result.symbol} ${result.parsedSignal.direction} ${result.parsedSignal.orderType ?? 'MARKET'}`,
        `VERDICT: ${result.verdict}`,
        `DECISION LABEL: ${result.decisionLabel}`,
        `REJECTION CATEGORY: ${result.rejectionCategory}`,
        `TRADE QUALITY SCORE: ${result.tradeQualityScore}/100`,
        `EXECUTION VALIDITY SCORE: ${result.executionValidityScore}/100`,
        `AI VERDICT CONFIDENCE: ${result.aiVerdictConfidence}%`,
        `REJECTION CONFIDENCE: ${result.rejectionConfidence}%`,
        `ACTION: ${action}`,
        `Source: ${source}`,
        receivedAt ? `Received: ${receivedAt}` : '',
        '',
        'SIGNAL SUMMARY',
        `Entry: ${formatNumber(result.parsedSignal.entry) ?? ''}`,
        `Stop Loss: ${formatNumber(result.parsedSignal.sl) ?? ''}`,
        `Take Profits: ${result.parsedSignal.tps.map(formatNumber).filter(Boolean).join(' | ')}`,
        `Current Price: ${formatNumber(result.technicalContext.currentPrice)}`,
        `Signal Age: ${result.executionValidity.signalAge}`,
        `Freshness: ${result.executionValidity.freshnessStatus}`,
        '',
        'HARD VALIDATION CHECKS',
        `Order Type Validity: ${result.executionValidity.orderTypeAssessment}`,
        `Current Price vs Entry: ${result.executionValidity.currentPriceVsEntry}`,
        `Current Price vs Stop Loss: ${result.executionValidity.currentPriceVsStopLoss}`,
        `Already Invalidated: ${result.executionValidity.alreadyInvalidated ? 'Yes' : 'No'}`,
        `Entry Distance: ${result.executionValidity.entryDistance}`,
        `Entry Distance in R: ${result.executionValidity.entryDistanceR ?? 'unavailable'}`,
        '',
        'RISK / REWARD',
        `Risk Size: ${formatNumber(result.riskReward.riskSize)}`,
        ...result.riskReward.tpAssessments.map((tp) => `${tp.tp}: ${tp.rr ?? 'n/a'}R · ${tp.quality} · ${tp.comment}`),
        `Assessment: ${result.riskReward.assessment}`,
        '',
        'TECHNICAL PAIR ANALYSIS',
        `Source: ${result.technicalContext.sourcePath}`,
        `Last Updated: ${result.technicalContext.lastUpdated ?? 'unknown'}`,
        `Trend: ${result.technicalContext.trend}`,
        `Market Structure: ${result.technicalContext.marketStructure ?? 'unavailable'}`,
        `Technical Score: ${result.technicalContext.technicalScore != null ? `${result.technicalContext.technicalScore}/100` : 'unavailable'}`,
        `Support: ${formatNumber(result.technicalContext.support)}`,
        `Resistance: ${formatNumber(result.technicalContext.resistance)}`,
        `Entry Location: ${result.technicalContext.entryLocationQuality}`,
        `Liquidity Context: ${result.technicalContext.liquidityContext}`,
        '',
        'FUNDAMENTAL INTELLIGENCE',
        `Source: ${result.fundamentalContext.sourcePath}`,
        `Last Updated: ${result.fundamentalContext.lastUpdated ?? 'unknown'}`,
        `Macro Bias: ${result.fundamentalContext.macroBias}${result.fundamentalContext.macroConfidence != null ? ` (${result.fundamentalContext.macroConfidence}%)` : ''}`,
        `Assessment: ${result.fundamentalContext.assessment}`,
        `Key Drivers: ${result.fundamentalContext.keyDrivers.join(' | ') || 'none'}`,
        '',
        'NEWS / SESSION / VOLATILITY',
        `Calendar Risk: ${result.newsAndSessionRisk.calendarRisk}`,
        `Headline Risk: ${result.newsAndSessionRisk.headlineRisk}`,
        `Session: ${result.newsAndSessionRisk.session}`,
        `Liquidity Quality: ${result.newsAndSessionRisk.liquidityQuality}`,
        `Spread Status: ${result.newsAndSessionRisk.spreadStatus}`,
        `Volatility: ${result.newsAndSessionRisk.volatility}`,
        `Assessment: ${result.newsAndSessionRisk.assessment}`,
        '',
        'CONFLICTS',
        result.conflicts.join(' | ') || 'none',
        '',
        'FINAL AI DECISION',
        `${decision.emoji} ${result.decisionLabel}`,
        `Primary Reason: ${result.primaryReason}`,
        `Hard Rejection Reasons: ${result.hardRejectionReasons.join(' | ') || 'none'}`,
        `Soft Concerns: ${result.softConcerns.join(' | ') || 'none'}`,
        `Positive Factors: ${result.positiveFactors.join(' | ') || 'none'}`,
        `Recommended Action: ${result.recommendedAction}`,
        '',
        'WHAT WOULD MAKE THIS TRADE VALID',
        result.whatWouldMakeItValid.join(' | ') || 'none',
        '',
        'TRADER CHECKLIST',
        ...result.checklist.map((item) => `${item.item}: ${item.status} — ${item.details}`),
        '',
        'SOURCE MESSAGE',
        message.rawText,
    ].filter((line) => line != null && line !== '').join('\n');
    return { html, text };
}
/**
 * Manual trigger: analyze the signal (or reuse a saved analysis) and send the
 * email to the configured recipient. Unlike `handleNewTelegramSignal`, this
 * always re-sends the email even if one was already sent before.
 */
async function sendEmailForMessage(messageId) {
    const message = await (0, telegramMessageStore_service_js_1.getTelegramMessageById)(messageId);
    if (!message)
        return { sent: false, error: 'Message not found.' };
    if (!message.symbol || !message.rawText) {
        return { sent: false, error: 'Message does not contain a tradable signal.' };
    }
    let validation = null;
    // Reuse the saved AI analysis when it completed successfully.
    if (message.autoAnalysisStatus === 'completed' || message.autoAnalysisStatus === 'fallback') {
        const saved = message.autoAnalysisResult;
        if (saved && typeof saved === 'object' && 'ok' in saved && saved.ok === true) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            validation = saved;
        }
    }
    // Fall back to running a fresh analysis.
    if (!validation) {
        const result = await (0, telegramSignalAnalyze_service_js_1.validateTelegramTradeSignal)(message.rawText, message.parsedSignal, {
            signalTime: message.telegramDate,
            sourceMessage: message.rawText,
        });
        if (result.ok === false) {
            return { sent: false, error: result.error };
        }
        validation = result;
        const now = new Date().toISOString();
        await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
            autoAnalysisStatus: validation.aiValidationUnavailable ? 'fallback' : 'completed',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            autoAnalysisResult: validation,
            autoAnalysisError: validation.aiValidationError ?? null,
            autoAnalysisAt: now,
        });
    }
    const prefs = await (0, notification_service_js_1.getPreferences)(process.env.DEFAULT_USER_ID ?? '');
    const cc = prefs.emailRecipient && prefs.emailRecipient !== TELEGRAM_ALERT_RECIPIENT ? prefs.emailRecipient : undefined;
    const email = buildTelegramSignalEmail(message, validation);
    const emailResult = await (0, mailer_js_1.sendMail)({
        to: TELEGRAM_ALERT_RECIPIENT,
        cc,
        subject: computeEmailSubject(validation),
        html: email.html,
        text: email.text,
        fromName: 'AlphaMentals Telegram',
        context: { signal: validation.symbol, messageId: message.id },
    });
    const now = new Date().toISOString();
    await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
        emailSentAt: emailResult.ok ? now : null,
        emailStatus: emailResult.ok ? 'sent' : 'failed',
        emailError: emailResult.ok ? null : (emailResult.error ?? 'Unknown email error'),
    });
    if (!emailResult.ok) {
        return { sent: false, error: emailResult.error ?? 'Email sending failed.' };
    }
    return { sent: true, verdict: validation.verdict, confidence: validation.confidence };
}
async function handleNewTelegramSignal(message) {
    if (!supportedAutoSignal(message))
        return { skipped: true, reason: 'Message is not a supported trading signal.' };
    if (message.emailSentAt)
        return { skipped: true, reason: 'Signal email already sent.' };
    if (message.autoAnalysisStatus === 'running')
        return { skipped: true, reason: 'Signal analysis already running.' };
    if (message.autoAnalysisStatus === 'failed')
        return { skipped: true, reason: 'Automatic analysis previously failed; manual retry only.' };
    if (message.signalHash) {
        const duplicate = await (0, telegramMessageStore_service_js_1.getTelegramMessageBySignalHash)(message.signalHash).catch(() => null);
        if (duplicate && duplicate.id !== message.id && duplicate.emailSentAt) {
            await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
                autoAnalysisStatus: 'skipped',
                emailStatus: 'skipped',
                emailError: 'Duplicate signal hash already processed.',
            });
            return { skipped: true, reason: 'Duplicate signal hash already processed.' };
        }
    }
    await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
        autoAnalysisStatus: 'running',
        emailStatus: 'pending',
        autoAnalysisError: null,
        emailError: null,
    });
    try {
        return await withTimeout((async () => {
            const validation = await (0, telegramSignalAnalyze_service_js_1.validateTelegramTradeSignal)(message.rawText, message.parsedSignal, {
                signalTime: message.telegramDate,
                sourceMessage: message.rawText,
            });
            if (validation.ok === false) {
                await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
                    autoAnalysisStatus: 'failed',
                    autoAnalysisError: validation.error,
                    autoAnalysisAt: new Date().toISOString(),
                    emailStatus: 'skipped',
                    emailError: validation.error,
                });
                await (0, notification_service_js_1.createNotification)({
                    title: 'Telegram signal auto-analysis failed',
                    message: validation.error,
                    category: 'telegram_signals',
                    severity: 'warning',
                    symbol: message.symbol ?? undefined,
                    metadata: { verdict: 'UNAVAILABLE', recipient: TELEGRAM_ALERT_RECIPIENT, messageId: message.telegramMessageId },
                    dedupeKey: `telegram-signal-failed:${message.id}`,
                });
                return { skipped: true, reason: validation.error };
            }
            const prefs = await (0, notification_service_js_1.getPreferences)(process.env.DEFAULT_USER_ID ?? '');
            const cc = prefs.emailRecipient && prefs.emailRecipient !== TELEGRAM_ALERT_RECIPIENT ? prefs.emailRecipient : undefined;
            const email = buildTelegramSignalEmail(message, validation);
            console.log('[auto-signal] Sending signal email', {
                provider: 'resend',
                signal: validation.symbol,
                messageId: message.id,
                stage: 'sending',
                recipient: TELEGRAM_ALERT_RECIPIENT,
            });
            const emailResult = await (0, mailer_js_1.sendMail)({
                to: TELEGRAM_ALERT_RECIPIENT,
                cc,
                subject: computeEmailSubject(validation),
                html: email.html,
                text: email.text,
                fromName: 'AlphaMentals Telegram',
                context: { signal: validation.symbol, messageId: message.id },
            });
            if (emailResult.ok) {
                console.log('[auto-signal] Signal email sent', {
                    provider: 'resend',
                    signal: validation.symbol,
                    messageId: message.id,
                    emailId: emailResult.emailId ?? null,
                    stage: 'sent',
                    recipient: TELEGRAM_ALERT_RECIPIENT,
                });
            }
            else {
                console.error('[auto-signal] Signal email failed', {
                    provider: 'resend',
                    signal: validation.symbol,
                    messageId: message.id,
                    stage: 'failed',
                    error: emailResult.error,
                });
            }
            const now = new Date().toISOString();
            await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
                autoAnalysisStatus: validation.aiValidationUnavailable ? 'fallback' : 'completed',
                autoAnalysisResult: validation,
                autoAnalysisError: validation.aiValidationError ?? null,
                autoAnalysisAt: now,
                emailSentAt: emailResult.ok ? now : null,
                emailStatus: emailResult.ok ? 'sent' : 'failed',
                emailError: emailResult.ok ? null : (emailResult.error ?? 'Unknown email error'),
            });
            await (0, notification_service_js_1.createNotification)({
                title: emailResult.ok ? 'Telegram signal email sent' : 'Telegram signal email failed',
                message: emailResult.ok
                    ? `${validation.symbol} ${validation.parsedSignal.direction} ${validation.parsedSignal.orderType ?? 'MARKET'} sent to ${TELEGRAM_ALERT_RECIPIENT} with verdict ${validation.verdict}.`
                    : `${validation.symbol} signal email failed: ${emailResult.error ?? 'Unknown error'}`,
                category: 'telegram_signals',
                severity: emailResult.ok ? 'info' : 'warning',
                symbol: validation.symbol,
                metadata: {
                    verdict: validation.verdict,
                    recipient: TELEGRAM_ALERT_RECIPIENT,
                    emailStatus: emailResult.ok ? 'sent' : 'failed',
                    confidence: validation.confidence,
                    finalAction: validation.finalAction,
                },
                dedupeKey: `telegram-signal-email:${message.id}`,
            });
            return { skipped: false, sent: emailResult.ok, validation };
        })(), AUTO_SIGNAL_TIMEOUT_MS);
    }
    catch (error) {
        const messageText = error instanceof Error ? error.message : 'Unknown automatic signal workflow error';
        await (0, telegramMessageStore_service_js_1.updateTelegramMessageAutomation)(message.id, {
            autoAnalysisStatus: 'failed',
            autoAnalysisError: messageText,
            autoAnalysisAt: new Date().toISOString(),
            emailStatus: 'failed',
            emailError: messageText,
        });
        await (0, notification_service_js_1.createNotification)({
            title: 'Telegram signal automation failed',
            message: messageText,
            category: 'telegram_signals',
            severity: 'warning',
            symbol: message.symbol ?? undefined,
            metadata: { recipient: TELEGRAM_ALERT_RECIPIENT, messageId: message.telegramMessageId },
            dedupeKey: `telegram-signal-error:${message.id}`,
        });
        return { skipped: true, reason: messageText };
    }
}
