export function deduplicateArticles<T extends { url?: string; title?: string }>(articles: T[]): T[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const key = a.url ?? a.title ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
