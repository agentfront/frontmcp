module.exports = {
  name: 'guard-cli-demo',
  version: '1.0.0',
  entry: './src/main.ts',
  esbuild: {
    external: [
      '@frontmcp/sdk',
      '@frontmcp/di',
      '@frontmcp/utils',
      '@frontmcp/auth',
      '@frontmcp/guard',
      '@frontmcp/storage-sqlite',
      '@frontmcp/adapters',
      '@frontmcp/adapters/*',
      'reflect-metadata',
      'zod',
      '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/sdk/*',
    ],
  },
  cli: {
    enabled: true,
    outputDefault: 'text',
    description: 'Guard CLI E2E Demo',
    excludeTools: [],
    nativeDeps: {},
  },
};
