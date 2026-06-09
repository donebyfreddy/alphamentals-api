module.exports = {
  apps: [
    {
      name: 'alphamentals-api',
      script: 'dist-api/backend/server/index.js',
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
  ],
};
