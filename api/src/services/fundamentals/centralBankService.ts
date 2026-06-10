import { fetchRssArticles } from '../news/rssNewsService.js';
import type { NormalizedNewsArticle } from '../news/fmpNewsService.js';

export async function fetchFedNews(): Promise<NormalizedNewsArticle[]> {
  return fetchRssArticles([{
    id: 'fed-press-rss',
    name: 'Federal Reserve',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
  }]);
}

export async function fetchEcbNews(): Promise<NormalizedNewsArticle[]> {
  return fetchRssArticles([{
    id: 'ecb-press-rss',
    name: 'European Central Bank',
    url: 'https://www.ecb.europa.eu/rss/press.html',
  }]);
}

export async function fetchBoeNews(): Promise<NormalizedNewsArticle[]> {
  return fetchRssArticles([{
    id: 'boe-press-rss',
    name: 'Bank of England',
    url: 'https://www.bankofengland.co.uk/rss/publications',
  }]);
}
