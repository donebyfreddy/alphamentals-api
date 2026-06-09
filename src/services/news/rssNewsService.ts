import type { NormalizedNewsArticle } from './fmpNewsService.js';

export async function fetchRssArticles(_sources?: { url?: string; id?: string }[]): Promise<NormalizedNewsArticle[]> {
  return [];
}
