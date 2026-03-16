/**
 * @file main.ts
 * @description Local ESM package server for E2E testing.
 * Serves fake npm registry metadata and CJS fixture bundles for the loader's
 * cache-to-native-import bridge.
 *
 * Packages served:
 * - @test/esm-tools v1.0.0 — 2 tools: echo, add (plain objects)
 * - @test/esm-multi v1.0.0 — 1 tool + 1 resource + 1 prompt (plain objects)
 * - @test/esm-decorated v1.0.0 — 2 tools + 1 resource + 1 prompt (real @Tool/@Resource/@Prompt decorators, esbuild-transpiled)
 *
 * URL patterns (same as esm.sh / npm registry):
 * - GET /{packageName}         → npm registry JSON (versions, dist-tags)
 * - GET /{packageName}@{ver}   → CJS bundle source code
 */

import * as http from 'node:http';
import { buildSync } from 'esbuild';
import * as path from 'node:path';

const rawPort = parseInt(process.env['PORT'] ?? process.env['ESM_SERVER_PORT'] ?? '50400', 10);
const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 50400;

// ═══════════════════════════════════════════════════════════════════
// FIXTURE BUNDLES (CJS format — the cache bridge unwraps the nested default on import)
// ═══════════════════════════════════════════════════════════════════

const ESM_TOOLS_BUNDLE = `
module.exports = {
  default: {
    name: '@test/esm-tools',
    version: '1.0.0',
    tools: [
      {
        name: 'echo',
        description: 'Echoes the input message back',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
          required: ['message'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: JSON.stringify(input) }],
        }),
      },
      {
        name: 'add',
        description: 'Adds two numbers together',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: String(Number(input.a) + Number(input.b)) }],
        }),
      },
    ],
  },
};
`;

const ESM_MULTI_BUNDLE = `
module.exports = {
  default: {
    name: '@test/esm-multi',
    version: '1.0.0',
    tools: [
      {
        name: 'greet',
        description: 'Greets a user by name',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
        execute: async (input) => ({
          content: [{ type: 'text', text: 'Hello, ' + (input.name || 'world') + '!' }],
        }),
      },
    ],
    resources: [
      {
        name: 'status',
        description: 'Server status',
        uri: 'esm://status',
        mimeType: 'application/json',
        read: async () => ({
          contents: [{ uri: 'esm://status', text: JSON.stringify({ status: 'ok', source: 'esm-multi' }) }],
        }),
      },
    ],
    prompts: [
      {
        name: 'greeting-prompt',
        description: 'A greeting prompt template',
        arguments: [
          { name: 'name', description: 'Name to greet', required: true },
        ],
        execute: async (args) => ({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'Please greet ' + (args.name || 'someone') + ' warmly.' },
            },
          ],
        }),
      },
    ],
  },
};
`;

// ═══════════════════════════════════════════════════════════════════
// DECORATED FIXTURE (esbuild-transpiled TypeScript with real decorators)
// ═══════════════════════════════════════════════════════════════════

function buildFixture(filename: string): string {
  const result = buildSync({
    entryPoints: [path.join(__dirname, 'fixtures', filename)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    write: false,
    external: ['@frontmcp/sdk', 'zod', 'reflect-metadata'],
  });
  // Strip esbuild's CJS annotation comment that contains the word "import",
  // which would cause the ESM loader's isEsmSource() to misdetect this as ESM
  return result.outputFiles[0].text.replace(/\/\/ Annotate the CommonJS export names for ESM import in node:\n/g, '');
}

const ESM_DECORATED_BUNDLE = buildFixture('decorated-package.ts');
const ESM_TOOLS_DECORATED_BUNDLE = buildFixture('tools-only-package.ts');
const ESM_RESOURCES_DECORATED_BUNDLE = buildFixture('resources-only-package.ts');
const ESM_PROMPTS_DECORATED_BUNDLE = buildFixture('prompts-only-package.ts');

// ═══════════════════════════════════════════════════════════════════
// PACKAGE REGISTRY
// ═══════════════════════════════════════════════════════════════════

interface VersionEntry {
  bundle: string;
  publishedAt: string;
  etag: string;
}

interface PackageEntry {
  name: string;
  versions: Record<string, VersionEntry>;
  'dist-tags': Record<string, string>;
}

function createVersionEntry(packageName: string, version: string, bundle: string): VersionEntry {
  return {
    bundle,
    publishedAt: new Date().toISOString(),
    etag: `"${packageName}@${version}:${Date.now()}"`,
  };
}

const packages = new Map<string, PackageEntry>();

packages.set('@test/esm-tools', {
  name: '@test/esm-tools',
  versions: { '1.0.0': createVersionEntry('@test/esm-tools', '1.0.0', ESM_TOOLS_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-multi', {
  name: '@test/esm-multi',
  versions: { '1.0.0': createVersionEntry('@test/esm-multi', '1.0.0', ESM_MULTI_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-decorated', {
  name: '@test/esm-decorated',
  versions: { '1.0.0': createVersionEntry('@test/esm-decorated', '1.0.0', ESM_DECORATED_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-tools-decorated', {
  name: '@test/esm-tools-decorated',
  versions: { '1.0.0': createVersionEntry('@test/esm-tools-decorated', '1.0.0', ESM_TOOLS_DECORATED_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-resources-decorated', {
  name: '@test/esm-resources-decorated',
  versions: { '1.0.0': createVersionEntry('@test/esm-resources-decorated', '1.0.0', ESM_RESOURCES_DECORATED_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-prompts-decorated', {
  name: '@test/esm-prompts-decorated',
  versions: { '1.0.0': createVersionEntry('@test/esm-prompts-decorated', '1.0.0', ESM_PROMPTS_DECORATED_BUNDLE) },
  'dist-tags': { latest: '1.0.0' },
});

// ═══════════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '/';
  const urlObj = new URL(url, `http://127.0.0.1:${port}`);
  let pathname: string;
  try {
    pathname = decodeURIComponent(urlObj.pathname).slice(1); // Remove leading /
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL encoding' }));
    return;
  }

  // Admin endpoint for runtime publishing (used by hot-reload E2E tests)
  if (req.method === 'POST' && pathname === '_admin/publish') {
    handleAdminPublish(req, res);
    return;
  }

  // Check if this is a versioned request: @scope/name@1.0.0
  const versionMatch = pathname.match(/^(.+?)@(\d+\.\d+\.\d+.*)$/);

  if (versionMatch) {
    serveBundleRequest(res, versionMatch[1], versionMatch[2]);
  } else {
    serveRegistryRequest(res, pathname);
  }
}

/**
 * POST /_admin/publish — publish a new version at runtime.
 * Body: { "package": "@test/esm-tools", "version": "2.0.0", "bundle": "module.exports = ..." }
 */
const MAX_ADMIN_BODY_BYTES = 1_048_576; // 1 MB

function handleAdminPublish(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  let aborted = false;
  req.on('error', () => {
    if (!aborted) {
      aborted = true;
      if (!res.headersSent) {
        res.writeHead(499, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Client disconnected' }));
      }
    }
  });
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_ADMIN_BODY_BYTES) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const data = JSON.parse(body) as {
        package: string;
        version: string;
        bundle: string;
      };

      if (!data.package || !data.version || !data.bundle) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: package, version, bundle' }));
        return;
      }

      let pkg = packages.get(data.package);
      if (!pkg) {
        pkg = {
          name: data.package,
          versions: {},
          'dist-tags': { latest: data.version },
        };
        packages.set(data.package, pkg);
      }

      pkg.versions[data.version] = createVersionEntry(data.package, data.version, data.bundle);
      pkg['dist-tags']['latest'] = data.version;

      console.log(`[admin] Published ${data.package}@${data.version}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, package: data.package, version: data.version }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

function serveRegistryRequest(res: http.ServerResponse, packageName: string): void {
  const pkg = packages.get(packageName);
  if (!pkg) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const versions: Record<string, unknown> = {};
  const time: Record<string, string> = {};

  for (const [ver, entry] of Object.entries(pkg.versions)) {
    versions[ver] = { version: ver, name: pkg.name };
    time[ver] = entry.publishedAt;
  }

  const registryData = {
    name: pkg.name,
    'dist-tags': pkg['dist-tags'],
    versions,
    time,
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(registryData));
}

function serveBundleRequest(res: http.ServerResponse, packageName: string, version: string): void {
  const pkg = packages.get(packageName);
  if (!pkg) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Package "${packageName}" not found`);
    return;
  }

  const versionEntry = pkg.versions[version];
  if (!versionEntry) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Version "${version}" not found for "${packageName}"`);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/javascript',
    ETag: versionEntry.etag,
  });
  res.end(versionEntry.bundle);
}

// ═══════════════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════

const server = http.createServer(handleRequest);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Packages: ${[...packages.keys()].join(', ')}`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`ESM Package Server started:`);
  console.log(`  Registry URL: ${baseUrl}`);
  console.log(`  ESM Base URL: ${baseUrl}`);
  console.log(`  Port: ${port}`);
  console.log(`  Packages: ${[...packages.keys()].join(', ')}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
