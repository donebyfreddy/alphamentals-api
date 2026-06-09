const baseUrl = (process.env.WORKER_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');

const routes = [
  '/api/health',
  '/api/market-data/quotes?symbols=XAUUSD,EURUSD,GBPUSD,DXY,USOIL',
  '/api/market-data/bias?symbol=XAUUSD',
  '/api/economic-calendar',
  '/api/mt5/status',
  '/api/journal/stats',
  '/api/analytics/patterns',
  '/api/trades/recent?limit=5',
];

async function checkRoute(route) {
  const url = `${baseUrl}${route}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();
  const trimmed = bodyText.trim();
  const isJson = contentType.toLowerCase().includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');

  if (!isJson) {
    throw new Error(`${route} returned non-JSON content-type=${contentType || 'unknown'} preview=${trimmed.slice(0, 160)}`);
  }

  try {
    JSON.parse(trimmed || '{}');
  } catch (error) {
    throw new Error(`${route} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`${response.status} ${route} ${contentType || 'application/json'}`);
}

for (const route of routes) {
  await checkRoute(route);
}

console.log('All Worker route checks passed.');
