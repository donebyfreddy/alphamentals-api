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
  ],
};
