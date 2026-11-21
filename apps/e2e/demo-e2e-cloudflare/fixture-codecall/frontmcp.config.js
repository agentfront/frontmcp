module.exports = {
  name: 'cf-codecall-fixture',
  entry: './src/main.ts',
  deployments: [{ target: 'cloudflare' }],
};
