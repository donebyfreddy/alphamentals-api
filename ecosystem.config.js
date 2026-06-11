const path = require('node:path');

module.exports = {
  apps: [
    // ── Node.js API (port 3001, public) ───────────────────────────────────────
    {
      name: 'alphamentals-api',
      script: 'api/dist-api/backend/server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      windowsHide: true,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3001',
        MT5_BRIDGE_URL: 'http://127.0.0.1:8001',
        MT5_BRIDGE_TIMEOUT_MS: '15000',
        CORS_ORIGINS: [
          'https://alphamentals-dashboard.pages.dev',
          'https://alphamentals-dashboard.vercel.app',
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'http://localhost:3003',
          'http://localhost:3004',
          'http://localhost:3005',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
          'http://127.0.0.1:3002',
          'http://127.0.0.1:3003',
          'http://127.0.0.1:3004',
          'http://127.0.0.1:3005',
        ].join(','),
      },
    },

    // ── Python MT5 Bridge (port 8001, loopback only) ──────────────────────────
    //
    // IMPORTANT: cwd must be the project root (not mt5bridge/) so that Python
    // resolves the package as "mt5bridge.app" and relative imports work.
    // windowsHide: true prevents a console window from appearing on Windows.
    {
      name: 'mt5-bridge',
      script: path.join(__dirname, 'mt5bridge', '.venv', 'Scripts', 'python.exe'),
      args: '-m uvicorn mt5bridge.app:app --host 127.0.0.1 --port 8001',
      cwd: __dirname,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      windowsHide: true,
      env: {
        PYTHONUNBUFFERED: '1',
        // Path to terminal64.exe — used by metatrader_service.py when calling mt5.initialize().
        // Leave unset to let MT5 auto-detect an already-running terminal.
        // MT5_TERMINAL_PATH: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe',
        MT5_TRADING_ENABLED: 'false',
        // MT5_API_KEY: '',  // same value as MT5_BRIDGE_API_KEY in the Node env above
      },
    },
  ],
};
