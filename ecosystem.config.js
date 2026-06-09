module.exports = {
  apps: [
    {
      name: 'alphamentals-mt5-bridge',
      cwd: __dirname,
      script: 'dist/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'alphamentals-api',
      cwd: __dirname,
      script: 'dist-api/backend/server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // API server port — must differ from the MT5 bridge (3001).
        // Nginx proxies api.alphamentals.com → 127.0.0.1:3000.
        PORT: 3000,
        MT5_BRIDGE_URL: 'http://127.0.0.1:3001',
      },
    },
  ],
};
