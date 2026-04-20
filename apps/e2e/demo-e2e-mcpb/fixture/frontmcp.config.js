/**
 * FrontMCP config for the MCPB e2e fixture.
 *
 * Uses the `deployments[]` (v1) config shape so the mcpb target picks up its
 * dedicated metadata via `findDeployment(config, 'mcpb')`. Top-level esbuild
 * externals live under `build.esbuild.external` (also part of the v1 schema).
 *
 * Setup-step translation is covered by unit integration tests — kept out of
 * the fixture to stay inside the strict v1 schema.
 */
module.exports = {
  name: 'mcpb-demo',
  version: '1.2.3',
  entry: './src/main.ts',
  nodeVersion: '>=22.0.0',
  build: {
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
  },
  deployments: [
    {
      target: 'mcpb',
      displayName: 'MCPB Demo',
      longDescription: '# MCPB Demo\n\nE2E fixture for the MCPB build target.',
      author: { name: 'FrontMCP E2E', email: 'e2e@agentfront.dev' },
      license: 'Apache-2.0',
      homepage: 'https://docs.agentfront.dev',
      keywords: ['mcpb', 'e2e'],
      compatibility: {
        platforms: ['darwin', 'linux', 'win32'],
        runtimes: { node: '>=22.0.0' },
      },
      deterministic: true,
    },
  ],
};
