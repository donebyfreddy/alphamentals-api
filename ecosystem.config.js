const path = require('path');

module.exports = {
  apps: [
    // ─── Node.js API (port 3001) ─────────────────────────────────────────────
    {
      name: 'alphamentals-api',
      script: 'api/dist-api/backend/server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3001',
        MT5_BRIDGE_URL: 'http://127.0.0.1:8001',
        CORS_ORIGINS: 'https://alphamentals-dashboard.vercel.app,http://localhost:3000',
      },
    },

    // ─── Python MT5 Bridge (port 8001, loopback only) ────────────────────────
    {
      name: 'mt5-bridge',
      script: path.join(__dirname, 'mt5bridge', '.venv', 'Scripts', 'python.exe'),
      args: '-m uvicorn app:app --host 127.0.0.1 --port 8001 --workers 1',
      cwd: path.join(__dirname, 'mt5bridge'),
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
