import { fetchRssArticles } from '../news/rssNewsService.js';
import type { NormalizedNewsArticle } from '../news/fmpNewsService.js';

export async function fetchPoliticalHeadlines(): Promise<NormalizedNewsArticle[]> {
  return fetchRssArticles([{
    id: 'reuters-business-rss',
    name: 'Reuters Business',
    url: 'https://feeds.reuters.com/reuters/businessNews',
  }]);
}
