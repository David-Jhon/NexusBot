module.exports = {
  apps: [
    {
      name: 'nexusbot',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
