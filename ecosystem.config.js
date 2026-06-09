module.exports = {
  apps: [
    {
      name: 'alphamentals-api',
      cwd: __dirname,
      script: 'dist-api/backend/server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_HOST: '0.0.0.0',
        // Nginx proxies api.alphamentals.com → 127.0.0.1:3001
        API_PORT: 3001,
        // Python MT5 bridge runs internally on port 8001
        MT5_BRIDGE_URL: 'http://127.0.0.1:8001',
      },
    },
  ],
};
