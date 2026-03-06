module.exports = {
  name: 'cli-exec-demo',
  version: '1.0.0',
  entry: './src/main.ts',
  esbuild: {
    external: [
      '@frontmcp/sdk',
      '@frontmcp/di',
      '@frontmcp/utils',
      '@frontmcp/auth',
      '@frontmcp/storage-sqlite',
      '@frontmcp/uipack',
      '@frontmcp/uipack/*',
      '@frontmcp/ui',
      '@frontmcp/ui/*',
      '@frontmcp/adapters',
      '@frontmcp/adapters/*',
      'reflect-metadata',
      'zod',
      '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/sdk/*',
    ],
  },
  sea: {
    enabled: true,
  },
  cli: {
    enabled: true,
    outputDefault: 'text',
    description: 'CLI Exec E2E Demo',
    excludeTools: [],
    nativeDeps: {},
  },
};
