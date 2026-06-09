import type { NormalizedNewsArticle } from './fmpNewsService.js';

export async function scrapeFallbackNews(_opts?: { enabled?: boolean; urls?: string[] }): Promise<NormalizedNewsArticle[]> {
  return [];
}
