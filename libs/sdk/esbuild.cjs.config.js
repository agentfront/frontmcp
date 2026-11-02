// The esbuild options of the CommonJS build (build-cjs). Its root takes src/lazy-subsystems.ts for ./subsystems, so a
// CommonJS process sets up jobs, workflows, channels, remote MCP and the ESM loader when it first reads their exports.
const path = require('node:path');

const ROOT_ENTRY = path.join('libs', 'sdk', 'src', 'index.ts');

const lazySubsystems = {
  name: 'lazy-subsystems',
  setup(build) {
    let swapped = false;
    build.onResolve({ filter: /^\.\/subsystems$/ }, (args) => {
      if (!args.importer.endsWith(ROOT_ENTRY)) return undefined;
      swapped = true;
      return { path: path.join(args.resolveDir, 'lazy-subsystems.ts') };
    });
    build.onEnd(() => {
      if (!swapped) throw new Error(`${ROOT_ENTRY} no longer imports ./subsystems for lazy-subsystems to swap`);
    });
  },
};

module.exports = {
  minifyWhitespace: true,
  outExtension: { '.js': '.js' },
  external: [
    '#js-yaml',
    '#semver',
    '#uipack-render',
    '#protocol-client',
    '@frontmcp/sdk',
    '@frontmcp/utils',
    '@frontmcp/di',
    '@frontmcp/lazy-zod',
    '@frontmcp/uipack',
    '@frontmcp/uipack/*',
    '@frontmcp/auth',
    '@frontmcp/guard',
    '@frontmcp/protocol',
    '@frontmcp/protocol/*',
    '@frontmcp/observability',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
    'ioredis',
    'jose',
    'reflect-metadata',
    'zod',
    'express',
    'cors',
    'raw-body',
    'content-type',
    '@vercel/kv',
    '#import-computed',
  ],
  plugins: [lazySubsystems],
};
