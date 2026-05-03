import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExtractedSchema } from '../../exec/cli-runtime/schema-extractor';
import {
  generateMcpbManifest,
  loadPackageJsonMeta,
  mcpbManifestSchema,
  normalizeRepository,
  parseAuthor,
  resolveIconPath,
} from '../manifest';

function emptySchema(partial: Partial<ExtractedSchema> = {}): ExtractedSchema {
  return {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    jobs: [],
    capabilities: { skills: false, jobs: false, workflows: false },
    skillAssets: [],
    ...partial,
  };
}

describe('parseAuthor', () => {
  it('returns unknown for empty input', () => {
    expect(parseAuthor(undefined)).toEqual({ name: 'unknown' });
  });

  it('parses npm-style string with email + url', () => {
    expect(parseAuthor('Ada Lovelace <ada@example.com> (https://ada.example)')).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      url: 'https://ada.example',
    });
  });

  it('handles string with name only', () => {
    expect(parseAuthor('Grace Hopper')).toEqual({ name: 'Grace Hopper' });
  });

  it('passes through object authors', () => {
    expect(parseAuthor({ name: 'Team' })).toEqual({ name: 'Team' });
  });

  it('falls back when author is a non-parsable value', () => {
    expect(parseAuthor(42)).toEqual({ name: '42' });
  });
});

describe('normalizeRepository', () => {
  it('normalizes string to git', () => {
    expect(normalizeRepository('https://github.com/acme/foo')).toEqual({
      type: 'git',
      url: 'https://github.com/acme/foo',
    });
  });

  it('keeps existing type', () => {
    expect(normalizeRepository({ type: 'svn', url: 'svn://example' })).toEqual({
      type: 'svn',
      url: 'svn://example',
    });
  });

  it('returns undefined for missing url', () => {
    expect(normalizeRepository(undefined)).toBeUndefined();
    expect(normalizeRepository({} as never)).toBeUndefined();
  });
});

describe('resolveIconPath', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-icon-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers deployment icon', () => {
    fs.writeFileSync(path.join(tmp, 'logo.png'), 'x');
    expect(resolveIconPath(tmp, 'logo.png')).toBe('logo.png');
  });

  it('falls back to icon.png in cwd', () => {
    fs.writeFileSync(path.join(tmp, 'icon.png'), 'x');
    expect(resolveIconPath(tmp)).toBe('icon.png');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveIconPath(tmp)).toBeUndefined();
  });
});

describe('loadPackageJsonMeta', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-pkg-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when package.json is absent', () => {
    expect(loadPackageJsonMeta(tmp)).toEqual({});
  });

  it('returns empty when package.json is invalid JSON', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{ not json');
    expect(loadPackageJsonMeta(tmp)).toEqual({});
  });

  it('parses valid package.json', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', author: 'Ada' }),
    );
    expect(loadPackageJsonMeta(tmp)).toEqual({ name: 'x', version: '1.0.0', author: 'Ada' });
  });
});

describe('generateMcpbManifest', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-gen-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a schema-valid minimal manifest', () => {
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema(),
      userConfig: {},
      userConfigEnv: {},
    });

    expect(manifest.manifest_version).toBe('0.3');
    expect(manifest.name).toBe('demo');
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('server/index.js');
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/server/index.js']);
    expect(manifest.tools_generated).toBe(false);
    expect(manifest.prompts_generated).toBe(true);

    const parsed = mcpbManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });

  it('populates fields from package.json fallbacks', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        description: 'Hello world',
        author: 'Ada <ada@example.com>',
        license: 'MIT',
        homepage: 'https://demo.example',
        repository: 'https://github.com/demo/repo',
        keywords: ['a', 'b'],
      }),
    );
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema(),
      userConfig: {},
      userConfigEnv: {},
    });

    expect(manifest.description).toBe('Hello world');
    expect(manifest.author).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(manifest.license).toBe('MIT');
    expect(manifest.homepage).toBe('https://demo.example');
    expect(manifest.repository).toEqual({ type: 'git', url: 'https://github.com/demo/repo' });
    expect(manifest.keywords).toEqual(['a', 'b']);
  });

  it('filters system tools and emits user tool list', () => {
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema({
        tools: [
          { name: 'greet', description: 'Say hi', inputSchema: {} },
          { name: 'execute-job', description: 'system', inputSchema: {} },
          { name: 'register-workflow', description: 'system', inputSchema: {} },
        ],
      }),
      userConfig: {},
      userConfigEnv: {},
    });

    expect(manifest.tools).toEqual([{ name: 'greet', description: 'Say hi' }]);
  });

  it('emits env + user_config when provided', () => {
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema(),
      userConfig: {
        apiKey: { type: 'string', title: 'API Key', required: true, sensitive: true },
      },
      userConfigEnv: { API_KEY: '${user_config.apiKey}' },
    });

    expect(manifest.server.mcp_config.env).toEqual({ API_KEY: '${user_config.apiKey}' });
    expect(manifest.user_config?.apiKey.sensitive).toBe(true);
  });

  it('includes platform_overrides when provided', () => {
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema(),
      userConfig: {},
      userConfigEnv: {},
      platformOverrides: {
        'darwin-arm64': { command: '${__dirname}/bin/darwin-arm64/demo', args: [] },
      },
    });

    expect(manifest.server.mcp_config.platform_overrides).toBeDefined();
    expect(manifest.server.mcp_config.platform_overrides?.['darwin-arm64'].command).toContain(
      'darwin-arm64/demo',
    );
  });

  it('defaults compatibility to all three platforms and provided nodeVersion', () => {
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      nodeVersion: '>=24.0.0',
      schema: emptySchema(),
      userConfig: {},
      userConfigEnv: {},
    });

    expect(manifest.compatibility?.platforms?.sort()).toEqual(['darwin', 'linux', 'win32']);
    expect(manifest.compatibility?.runtimes?.node).toBe('>=24.0.0');
  });

  // #376 — `@Resource`-decorated entries were dropped from the MCPB manifest
  // even though they registered at runtime, leaving Claude Desktop and other
  // MCPB consumers blind to them.
  describe('resources (#376)', () => {
    it('emits a resources array when the schema contains resources', () => {
      const manifest = generateMcpbManifest({
        name: 'demo',
        version: '1.0.0',
        cwd: tmp,
        schema: emptySchema({
          resources: [
            { uri: 'calc://status', name: 'calc-status', description: 'Per-op call counts', mimeType: 'application/json' },
          ],
        }),
        userConfig: {},
        userConfigEnv: {},
      });
      expect(manifest.resources).toEqual([
        {
          name: 'calc-status',
          uri: 'calc://status',
          description: 'Per-op call counts',
          mimeType: 'application/json',
        },
      ]);
      expect(manifest.resources_generated).toBe(true);
    });

    it('omits the resources field entirely when none are registered', () => {
      const manifest = generateMcpbManifest({
        name: 'demo',
        version: '1.0.0',
        cwd: tmp,
        schema: emptySchema(),
        userConfig: {},
        userConfigEnv: {},
      });
      expect(manifest.resources).toBeUndefined();
      expect(manifest.resources_generated).toBeUndefined();
    });
  });

  it('overrides from deployment take precedence over package.json', () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo', description: 'pkg desc', license: 'MIT' }),
    );
    const manifest = generateMcpbManifest({
      name: 'demo',
      version: '1.0.0',
      cwd: tmp,
      schema: emptySchema(),
      userConfig: {},
      userConfigEnv: {},
      deployment: {
        target: 'mcpb',
        longDescription: 'Override markdown',
        license: 'Apache-2.0',
        author: { name: 'Override' },
      },
    });

    expect(manifest.long_description).toBe('Override markdown');
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.author).toEqual({ name: 'Override' });
  });
});
