module.exports = {
  name: 'cf-worker-fixture',
  entry: './src/main.ts',
  deployments: [{ target: 'cloudflare' }],
};
