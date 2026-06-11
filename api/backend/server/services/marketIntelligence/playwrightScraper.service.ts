type ScrapeResult = {
  url: string;
  text: string;
  links: Array<{ href: string; text: string }>;
  timestamps: string[];
  tables: string[][];
};

function envTrue(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export class PlaywrightScraperService {
  private readonly enabled = envTrue(process.env.SCRAPING_ENABLED, true);
  private readonly headless = envTrue(process.env.PLAYWRIGHT_HEADLESS, true);
  private readonly timeoutMs = Number(process.env.PLAYWRIGHT_TIMEOUT_MS ?? '20000');
  private readonly retries = 2;

  async scrapePage(url: string): Promise<ScrapeResult> {
    if (!this.enabled) {
      throw new Error('Scraping disabled by SCRAPING_ENABLED=false');
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      try {
        return await this.scrapeOnce(url);
      } catch (error) {
        lastError = error;
        console.warn(`[playwright] scrape attempt ${attempt}/${this.retries} failed for ${url}:`, error instanceof Error ? error.message : String(error));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async scrapeOnce(url: string): Promise<ScrapeResult> {
    const { chromium } = await import('playwright');
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>> | null = null;
    let page: Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>['newPage']>> | null = null;

    try {
      browser = await chromium.launch({
        headless: this.headless,
        timeout: this.timeoutMs,
      });
      context = await browser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      });
      page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: Math.min(this.timeoutMs, 10_000) }).catch(() => undefined);

      const payload = await page.evaluate(() => {
        const text = document.body?.innerText ?? '';
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map((node) => ({
            href: (node as HTMLAnchorElement).href,
            text: node.textContent?.trim() ?? '',
          }))
          .filter((item) => item.href)
          .slice(0, 100);
        const timestamps = Array.from(document.querySelectorAll('time'))
          .map((node) => node.getAttribute('datetime') || node.textContent || '')
          .filter(Boolean)
          .slice(0, 50);
        const tables = Array.from(document.querySelectorAll('table')).slice(0, 10).map((table) =>
          Array.from(table.querySelectorAll('tr')).slice(0, 30).map((row) =>
            Array.from(row.querySelectorAll('th,td'))
              .map((cell) => cell.textContent?.trim() ?? '')
              .filter(Boolean)
              .join(' | ')
          ).filter(Boolean)
        );
        return { text, links, timestamps, tables };
      });

      return {
        url,
        text: payload.text,
        links: payload.links,
        timestamps: payload.timestamps,
        tables: payload.tables,
      };
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }
}
