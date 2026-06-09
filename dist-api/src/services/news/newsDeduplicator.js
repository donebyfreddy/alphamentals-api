"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deduplicateArticles = deduplicateArticles;
function deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter((a) => {
        const key = a.url ?? a.title ?? '';
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
