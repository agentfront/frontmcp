/**
 * @file main.ts
 * @description Local ESM package server for E2E testing.
 * Serves fake npm registry metadata and CJS bundles that mimic esm.sh behavior.
 *
 * Packages served:
 * - @test/esm-tools v1.0.0 — 2 tools: echo, add
 * - @test/esm-multi v1.0.0 — 1 tool + 1 resource + 1 prompt
 *
 * URL patterns (same as esm.sh / npm registry):
 * - GET /{packageName}         → npm registry JSON (versions, dist-tags)
 * - GET /{packageName}@{ver}   → CJS bundle source code
 */

import * as http from 'node:http';

const port = parseInt(process.env['ESM_SERVER_PORT'] ?? '50410', 10);

// ═══════════════════════════════════════════════════════════════════
// FIXTURE BUNDLES (CJS format — normalizeEsmExport handles the default wrapper)
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
// PACKAGE REGISTRY
// ═══════════════════════════════════════════════════════════════════

interface PackageEntry {
  name: string;
  versions: Record<string, { bundle: string }>;
  'dist-tags': Record<string, string>;
}

const packages = new Map<string, PackageEntry>();

packages.set('@test/esm-tools', {
  name: '@test/esm-tools',
  versions: { '1.0.0': { bundle: ESM_TOOLS_BUNDLE } },
  'dist-tags': { latest: '1.0.0' },
});

packages.set('@test/esm-multi', {
  name: '@test/esm-multi',
  versions: { '1.0.0': { bundle: ESM_MULTI_BUNDLE } },
  'dist-tags': { latest: '1.0.0' },
});

// ═══════════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '/';
  const urlObj = new URL(url, `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(urlObj.pathname).slice(1); // Remove leading /

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
function handleAdminPublish(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
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

      pkg.versions[data.version] = { bundle: data.bundle };
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

  for (const ver of Object.keys(pkg.versions)) {
    versions[ver] = { version: ver, name: pkg.name };
    time[ver] = new Date().toISOString();
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
    ETag: `"${packageName}@${version}"`,
  });
  res.end(versionEntry.bundle);
}

// ═══════════════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════

const server = http.createServer(handleRequest);

server.listen(port, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`ESM Package Server started:`);
  console.log(`  Registry URL: ${baseUrl}`);
  console.log(`  ESM Base URL: ${baseUrl}`);
  console.log(`  Port: ${port}`);
  console.log(`  Packages: ${[...packages.keys()].join(', ')}`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
