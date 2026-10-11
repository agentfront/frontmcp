import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDeterministicZip } from '../zip';
import { createRuntimeRequireScanner, findRuntimeRequires, validateMcpb } from '../validate';

async function makeArchive(
  fileMap: Record<string, string>,
  archivePath: string,
): Promise<void> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-stage-'));
  try {
    for (const [rel, content] of Object.entries(fileMap)) {
      const abs = path.join(stage, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    await createDeterministicZip(stage, archivePath);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

const baseManifest = () => ({
  manifest_version: '0.3',
  name: 'demo',
  version: '1.0.0',
  description: 'Demo',
  author: { name: 'Tester' },
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
  },
});

describe('validateMcpb', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-validate-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects a non-existent archive', async () => {
    const result = await validateMcpb(path.join(tmp, 'missing.mcpb'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Cannot open archive/);
  });

  it('accepts a valid archive', async () => {
    const archive = path.join(tmp, 'ok.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'console.log("hi")',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when the server requires runtime packages the archive does not ship', async () => {
    const archive = path.join(tmp, 'unrunnable.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'require("reflect-metadata");\nconst sdk = require("@frontmcp/sdk");',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"@frontmcp/sdk"') && e.includes('cannot start'))).toBe(true);
    expect(result.errors.some((e) => e.includes('"reflect-metadata"'))).toBe(true);
  });

  it('flags subpath requires of runtime packages', async () => {
    const archive = path.join(tmp, 'subpath.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': "require('@frontmcp/utils/fs');",
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"@frontmcp/utils"'))).toBe(true);
  });

  it('accepts externalized requires when the archive ships server/node_modules', async () => {
    const archive = path.join(tmp, 'with-modules.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'require("@frontmcp/sdk");',
        'server/node_modules/@frontmcp/sdk/index.js': 'module.exports = {};',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(true);
  });

  it('reports a bare require the archive cannot satisfy, such as an external native addon', async () => {
    const archive = path.join(tmp, 'native-addon.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'const Database = require("better-sqlite3-multiple-ciphers");',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"better-sqlite3-multiple-ciphers"'))).toBe(true);
  });

  it('accepts built-ins, packages the archive ships, guarded optional peers, and require text inside strings', async () => {
    const archive = path.join(tmp, 'resolvable.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': [
          'const fs = require("fs");',
          'const path = require("node:path");',
          'const addon = require("better-sqlite3-multiple-ciphers");',
          'function loadObservability() { try { return require("@frontmcp/observability"); } catch { return undefined; } }',
          `equal.code = 'require("ajv/dist/runtime/equal").default';`,
        ].join('\n'),
        'server/node_modules/better-sqlite3-multiple-ciphers/package.json': '{"name":"better-sqlite3-multiple-ciphers"}',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
  });

  it('warns, without failing, about packages FrontMCP loads only when a feature is configured', async () => {
    const archive = path.join(tmp, 'lazy.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': [
          'function loadBetterSqlite3() { return require("better-sqlite3"); }',
          'function loadSqliteStorage() { return require("@frontmcp/storage-sqlite"); }',
          'async function loadEnclave() { return import("@enclave-vm/core"); }',
        ].join('\n'),
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      'server/index.js requires "better-sqlite3", which FrontMCP loads only when SQLite storage is configured; list it in build.dependencies.nativeAddons if your server uses it',
    );
    expect(result.warnings.some((w) => w.includes('"@enclave-vm/core"') && w.includes('dynamic jobs'))).toBe(true);
  });

  it('passes a server whose FrontMCP observability peers are not installed (CI), with at most warnings', async () => {
    const archive = path.join(tmp, 'observability-missing.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': [
          'function requireOptionalModule(name, load) { try { return load(); } catch { return undefined; } }',
          'const observability = requireOptionalModule("@frontmcp/observability", () => require("@frontmcp/observability"));',
          'function consoleExporter() { return require("@opentelemetry/sdk-trace-base").ConsoleSpanExporter; }',
          'try { require("@opentelemetry/exporter-trace-otlp-http"); } catch { throw new Error("install it"); }',
          'try { require("@opentelemetry/sdk-node"); } catch {}',
        ].join('\n'),
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts a bundle of ws and node-fetch, whose optional peers stay as guarded requires', async () => {
    const esbuild = require('esbuild') as typeof import('esbuild');
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..');
    const bundle = esbuild.buildSync({
      stdin: { contents: 'module.exports = { ws: require("ws"), fetch: require("node-fetch") };', resolveDir: repoRoot, loader: 'js' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    }).outputFiles[0].text;
    expect(bundle).toMatch(/require\("bufferutil"\)/);
    expect(bundle).toMatch(/require\("encoding"\)/);
    const archive = path.join(tmp, 'ws-node-fetch.mcpb');
    await makeArchive({ 'manifest.json': JSON.stringify(baseManifest()), 'server/index.js': bundle }, archive);
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['server/node_modules (FrontMCP layout)', 'server/node_modules/shipped-dep/package.json'],
    ['node_modules at the archive root (MCPB layout)', 'node_modules/shipped-dep/package.json'],
  ])('accepts a package shipped in %s', async (_layout, shippedFile) => {
    const archive = path.join(tmp, 'layout.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'const dep = require("shipped-dep/lib/index.js");',
        [shippedFile]: '{"name":"shipped-dep"}',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
  });

  it('does not count a package shipped outside the entry point folder chain', async () => {
    const archive = path.join(tmp, 'elsewhere.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'const dep = require("shipped-dep");',
        'other/node_modules/shipped-dep/package.json': '{"name":"shipped-dep"}',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors.some((e) => e.includes('"shipped-dep"'))).toBe(true);
  });

  it('parses an ESM server entry with top-level await', async () => {
    const archive = path.join(tmp, 'esm.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'import { Server } from "shipped-sdk";\nawait new Server().connect();\nconst missing = await import("not-shipped");',
        'server/node_modules/shipped-sdk/package.json': '{"name":"shipped-sdk"}',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors.some((e) => e.includes('could not be parsed'))).toBe(false);
    expect(result.errors.some((e) => e.includes('"not-shipped"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('"shipped-sdk"'))).toBe(false);
  });

  it('does not warn about node_modules in an archive that ships native addons', async () => {
    const archive = path.join(tmp, 'addon-shipped.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'const addon = require("my-addon");',
        'server/node_modules/my-addon/package.json': '{"name":"my-addon"}',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.warnings.some((w) => w.includes('node_modules'))).toBe(false);
  });

  it('reports a server entry that is not valid JavaScript', async () => {
    const archive = path.join(tmp, 'broken-entry.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(baseManifest()),
        'server/index.js': 'const = require("x");',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('server/index.js could not be parsed'))).toBe(true);
  });

  it('fails when manifest.json is missing', async () => {
    const archive = path.join(tmp, 'no-manifest.mcpb');
    await makeArchive({ 'server/index.js': 'hi' }, archive);
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest.json is missing'))).toBe(true);
  });

  it('fails when entry_point is not in the archive', async () => {
    const archive = path.join(tmp, 'missing-entry.mcpb');
    await makeArchive({ 'manifest.json': JSON.stringify(baseManifest()) }, archive);
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('entry_point'))).toBe(true);
  });

  it('fails on unknown substitution variable', async () => {
    const manifest = baseManifest();
    manifest.server.mcp_config.args = ['${MYSTERY_VAR}'];
    const archive = path.join(tmp, 'bad-var.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'hi',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('MYSTERY_VAR'))).toBe(true);
  });

  it('fails on dangling user_config reference', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: { env: Record<string, string> } }).mcp_config.env = {
      API: '${user_config.missing}',
    };
    const archive = path.join(tmp, 'bad-ref.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'hi',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('user_config.missing'))).toBe(true);
  });

  it('resolves user_config reference when declared', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: { env: Record<string, string> } }).mcp_config.env = {
      API: '${user_config.apiKey}',
    };
    manifest.user_config = {
      apiKey: { type: 'string', title: 'API Key' },
    };
    const archive = path.join(tmp, 'with-cfg.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'hi',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(true);
  });

  it('fails on invalid manifest_version absence', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    delete manifest.manifest_version;
    const archive = path.join(tmp, 'no-version.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'hi',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest_version'))).toBe(true);
  });

  it('validates platform_overrides binary references exist', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: Record<string, unknown> }).mcp_config.platform_overrides = {
      'darwin-arm64': { command: '${__dirname}/bin/darwin-arm64/demo', args: [] },
    };
    const archive = path.join(tmp, 'bad-binary.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'hi',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('darwin-arm64'))).toBe(true);
  });

  // #730 — hosts look up platform_overrides[process.platform], so an OS/arch key never matches
  it('warns about a platform_overrides key that is not an OS name', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: Record<string, unknown> }).mcp_config.platform_overrides = {
      'linux-x64': { command: '${__dirname}/bin/linux-x64/demo', args: [] },
      win32: { command: '${__dirname}/bin/win32-x64/demo.exe', args: [] },
    };
    const archive = path.join(tmp, 'arch-keys.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'console.log("self-contained")',
        'bin/linux-x64/demo': 'binary',
        'bin/win32-x64/demo.exe': 'binary',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.warnings).toEqual([expect.stringContaining('platform_overrides["linux-x64"] is never used')]);
    expect(result.ok).toBe(true);
  });

  // #679 — `--sea` binaries left reflect-metadata external and died with
  // "No such built-in module: reflect-metadata", yet validated as fine.
  it('fails when an SEA binary requires runtime packages it cannot load', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: Record<string, unknown> }).mcp_config.platform_overrides = {
      darwin: { command: '${__dirname}/bin/darwin-arm64/demo', args: [] },
    };
    const archive = path.join(tmp, 'sea-externals.mcpb');
    const binary = `\u0000ELF-ish header\u0000${'x'.repeat(70_000)}require("reflect-metadata");\u0000tail`;
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'console.log("self-contained")',
        'bin/darwin-arm64/demo': binary,
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.stringMatching(/^bin\/darwin-arm64\/demo requires "reflect-metadata", which a single-executable binary/),
    ]);
  });

  it('accepts an SEA binary with the runtime inlined', async () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    (manifest.server as { mcp_config: Record<string, unknown> }).mcp_config.platform_overrides = {
      darwin: { command: '${__dirname}/bin/darwin-arm64/demo', args: [] },
    };
    const archive = path.join(tmp, 'sea-ok.mcpb');
    await makeArchive(
      {
        'manifest.json': JSON.stringify(manifest),
        'server/index.js': 'console.log("self-contained")',
        'bin/darwin-arm64/demo': 'binary with require("node:fs") and a "@frontmcp/sdk" string only',
      },
      archive,
    );
    const result = await validateMcpb(archive);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('runtime require scanning', () => {
  it('finds bare and subpath requires with either quote style', () => {
    expect(findRuntimeRequires(`require('@frontmcp/di'); require("@frontmcp/utils/fs")`)).toEqual([
      '@frontmcp/di',
      '@frontmcp/utils',
    ]);
    expect(findRuntimeRequires('require("node:path")')).toEqual([]);
  });

  it('finds a require split across two streamed chunks', () => {
    const scanner = createRuntimeRequireScanner();
    scanner.push(Buffer.from('....require("reflect-me'));
    scanner.push(Buffer.from('tadata");....'));
    expect(scanner.found()).toEqual(['reflect-metadata']);
  });
});
