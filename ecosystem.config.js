module.exports = {
  apps: [
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
        CORS_ORIGINS: 'https://alphamentals-dashboard.vercel.app,http://localhost:3000',
      },
    },
  ],
};
