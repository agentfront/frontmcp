import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDeterministicZip } from '../zip';
import { validateMcpb } from '../validate';

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
});
