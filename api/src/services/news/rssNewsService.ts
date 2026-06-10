import type { NormalizedNewsArticle } from './fmpNewsService.js';
import { detectAffectedSymbols, detectImpactLevel } from '../fundamentals/currencyImpactMapper.js';

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // CDATA form
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i');
  const m1 = cdataRe.exec(xml);
  if (m1?.[1]) return m1[1].trim();

  // Normal form
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i');
  const m2 = re.exec(xml);
  return m2?.[1]?.trim() ?? '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]+\\s${attr}=['"]([^'"]+)['"]`, 'i');
  return re.exec(xml)?.[1] ?? '';
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  // Atom feeds use <entry>
  const re2 = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  while ((m = re2.exec(xml)) !== null) items.push(m[1]);
  return items;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(raw: string): string {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

function inferSentiment(text: string): NormalizedNewsArticle['sentiment'] {
  const t = text.toLowerCase();
  const bullish = ['rally', 'surge', 'rise', 'gain', 'jump', 'soar', 'strong', 'bullish', 'upbeat', 'hawkish', 'beat', 'better than expected', 'above forecast', 'outperform'].filter((k) => t.includes(k)).length;
  const bearish = ['fall', 'drop', 'plunge', 'decline', 'weak', 'bearish', 'miss', 'worse than expected', 'below forecast', 'slump', 'dovish', 'concern', 'worry', 'risk', 'recession'].filter((k) => t.includes(k)).length;
  if (bullish > bearish + 1) return 'bullish';
  if (bearish > bullish + 1) return 'bearish';
  if (bullish > 0 && bearish > 0) return 'mixed';
  return 'neutral';
}

function makeId(url: string, title: string): string {
  const raw = (url || title).slice(0, 120);
  return `rss_${Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
}

// ── RSS fetch ─────────────────────────────────────────────────────────────────

const RSS_TIMEOUT_MS = 12_000;

async function fetchRssXml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AlphamentalsBot/1.0; market intelligence aggregator)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml: string, sourceName: string): NormalizedNewsArticle[] {
  const now = new Date().toISOString();
  const items = extractItems(xml);
  const articles: NormalizedNewsArticle[] = [];

  for (const item of items) {
    const title = stripHtml(
      extractTag(item, 'title')
      || extractAttr(item, 'title', 'href')
    );
    if (!title || title.length < 5) continue;

    const link = (
      extractTag(item, 'link')
      || extractAttr(item, 'link', 'href')
      || extractTag(item, 'guid')
    ).replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();

    const descriptionRaw = (
      extractTag(item, 'description')
      || extractTag(item, 'summary')
      || extractTag(item, 'content:encoded')
      || extractTag(item, 'content')
    );
    const description = stripHtml(descriptionRaw).slice(0, 800);

    const pubDate = (
      extractTag(item, 'pubDate')
      || extractTag(item, 'published')
      || extractTag(item, 'dc:date')
      || extractTag(item, 'updated')
    );
    const publishedAt = parseDate(pubDate);

    // Skip items older than 7 days
    const ageMs = Date.now() - new Date(publishedAt).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) continue;

    const textForAnalysis = `${title} ${description}`;
    const sentiment = inferSentiment(textForAnalysis);
    const impact = detectImpactLevel({ title });
    const affectedSymbols = detectAffectedSymbols({ title, eventName: title, currency: '' });
    const affectedCurrencies = Array.from(
      new Set(affectedSymbols.flatMap((s) => s.split('/').filter((c) => c.length === 3))),
    );

    articles.push({
      id: makeId(link, title),
      title: title.slice(0, 300),
      summary: description.slice(0, 600) || title,
      contentSnippet: description.slice(0, 300) || null,
      url: link || '',
      publishedAt,
      fetchedAt: now,
      source: sourceName,
      sourceType: 'rss',
      affectedSymbols,
      affectedCurrencies,
      impact,
      sentiment,
      rawData: null,
    });
  }

  // Sort by newest first, cap at 40 per source
  return articles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 40);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RssSourceInput {
  id: string;
  url?: string;
  name?: string;
}

export async function fetchRssArticles(sources?: RssSourceInput[]): Promise<NormalizedNewsArticle[]> {
  if (!sources?.length) return [];

  const all: NormalizedNewsArticle[] = [];

  for (const src of sources) {
    if (!src.url) continue;
    try {
      const xml = await fetchRssXml(src.url);
      const articles = parseRssItems(xml, src.name ?? src.id ?? 'rss');
      all.push(...articles);
      console.info(`[rss] ${src.id}: fetched ${articles.length} articles`);
    } catch (err) {
      // Non-fatal — individual source failure is expected
      console.warn(`[rss] ${src.id} (${src.url}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return all;
}
