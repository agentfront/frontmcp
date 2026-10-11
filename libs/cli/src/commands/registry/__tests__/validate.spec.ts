import { SERVER_JSON_SCHEMA_URL, type ServerJson } from '../server-json';
import { npmMcpNameIssues, validateServerJson } from '../validate';

const validServerJson: ServerJson = {
  $schema: SERVER_JSON_SCHEMA_URL,
  name: 'com.acme/weather',
  description: 'Forecasts for any city',
  version: '1.2.0',
  title: 'Acme Weather',
  websiteUrl: 'https://acme.com/weather',
  icons: [{ src: 'https://acme.com/icon.png' }],
  repository: { url: 'https://github.com/acme/weather', source: 'github', subfolder: 'apps/weather' },
  remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.com/mcp' }],
  packages: [{ registryType: 'npm', identifier: '@acme/weather', version: '1.2.0', transport: { type: 'stdio' } }],
};

function issuesFor(overrides: Record<string, unknown>) {
  return validateServerJson({ ...validServerJson, ...overrides });
}

describe('validateServerJson', () => {
  it('accepts a complete server.json', () => {
    expect(validateServerJson(validServerJson)).toEqual([]);
  });

  it('rejects unknown fields at any depth, as the Registry does', () => {
    expect(issuesFor({ author: 'me' })).toEqual([{ path: '', message: expect.stringContaining('author') }]);
    expect(issuesFor({ remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.com/mcp', auth: 'x' }] })).toEqual([
      { path: 'remotes[0]', message: expect.stringContaining('auth') },
    ]);
    expect(issuesFor({ _meta: { 'com.acme/custom': {} } })).toEqual([
      { path: '_meta', message: expect.stringContaining('com.acme/custom') },
    ]);
  });

  it('requires $schema, name, description and version', () => {
    const paths = validateServerJson({}).map((issue) => issue.path);
    expect(paths.sort()).toEqual(['$schema', 'description', 'name', 'version']);
  });

  it.each([
    'weather',
    'com.acme/-weather',
    'com.acme/a',
    '.acme/weather',
    'com.acme/weather/extra',
    'com acme/weather',
  ])('rejects the name %p', (name) => {
    expect(issuesFor({ name }).map((issue) => issue.path)).toContain('name');
  });

  it('limits the description to 1-100 characters', () => {
    expect(issuesFor({ description: '' })).toEqual([{ path: 'description', message: expect.any(String) }]);
    expect(issuesFor({ description: 'x'.repeat(101) })).toEqual([{ path: 'description', message: expect.any(String) }]);
    expect(issuesFor({ description: 'x'.repeat(100) })).toEqual([]);
  });

  it.each(['latest', '^1.2.0', '~1.2.0', '>=1.0.0', '1.x', '1.2.*', '1.0.0 - 2.0.0', '1.2 || 1.3'])(
    'rejects the version %p',
    (version) => {
      expect(issuesFor({ version })).toEqual([{ path: 'version', message: expect.any(String) }]);
    },
  );

  it.each(['1.2.0', '1.2.0-beta.1', '2026.10.11', 'v3'])('accepts the version %p', (version) => {
    expect(issuesFor({ version })).toEqual([]);
  });

  it('requires https URLs for the website and icons', () => {
    expect(issuesFor({ websiteUrl: 'http://acme.com' })).toEqual([
      { path: 'websiteUrl', message: expect.stringContaining('https') },
    ]);
    expect(issuesFor({ icons: [{ src: 'http://acme.com/icon.png' }] })).toEqual([
      { path: 'icons[0].src', message: expect.stringContaining('https') },
    ]);
  });

  it.each([
    ['http://mcp.acme.com/mcp', 'https'],
    ['https://localhost:3000/mcp', 'localhost'],
    ['https://127.0.0.1/mcp', 'localhost'],
    ['https://app.localhost/mcp', 'localhost'],
  ])('rejects the remote URL %s', (url, reason) => {
    expect(issuesFor({ remotes: [{ type: 'streamable-http', url }] })).toEqual([
      { path: 'remotes[0].url', message: expect.stringContaining(reason) },
    ]);
  });

  it('accepts a templated remote URL and rejects remote types other than streamable-http and sse', () => {
    expect(issuesFor({ remotes: [{ type: 'sse', url: 'https://{tenant}.acme.com/sse' }] })).toEqual([]);
    expect(issuesFor({ remotes: [{ type: 'stdio', url: 'https://mcp.acme.com' }] })).toEqual([
      { path: 'remotes[0].type', message: expect.any(String) },
    ]);
  });

  it('checks the repository source, URL and subfolder', () => {
    expect(issuesFor({ repository: { url: 'https://bitbucket.org/acme/w', source: 'bitbucket' } })).toEqual([
      { path: 'repository', message: expect.any(String) },
    ]);
    expect(
      issuesFor({ repository: { url: 'https://github.com/acme/w', source: 'github', subfolder: '../w' } }),
    ).toEqual([{ path: 'repository.subfolder', message: expect.any(String) }]);
  });

  it('checks package identifiers, versions and transports', () => {
    expect(
      issuesFor({
        packages: [
          { registryType: 'npm', identifier: 'bad name', version: 'latest', transport: { type: 'stdio', url: 'x' } },
        ],
      }).map((issue) => issue.path),
    ).toEqual(['packages[0].identifier', 'packages[0].version', 'packages[0].transport.url']);
  });

  it('limits publisher-provided _meta to 4 KB', () => {
    const meta = { 'io.modelcontextprotocol.registry/publisher-provided': { blob: 'x'.repeat(5000) } };
    expect(issuesFor({ _meta: meta })).toEqual([
      { path: '_meta.io.modelcontextprotocol.registry/publisher-provided', message: expect.stringContaining('4 KB') },
    ]);
  });

  it('rejects a whitespace-only title', () => {
    expect(issuesFor({ title: '   ' })).toEqual([{ path: 'title', message: expect.any(String) }]);
  });
});

describe('npmMcpNameIssues', () => {
  it('passes when package.json mcpName equals the server name', () => {
    expect(npmMcpNameIssues(validServerJson, { mcpName: 'com.acme/weather' })).toEqual([]);
  });

  it('says how to add a missing or different mcpName', () => {
    expect(npmMcpNameIssues(validServerJson, {})).toEqual([
      { path: 'packages[0]', message: expect.stringContaining('"mcpName": "com.acme/weather"') },
    ]);
    expect(npmMcpNameIssues(validServerJson, { mcpName: 'com.other/weather' })[0].message).toContain(
      'has "mcpName": "com.other/weather"',
    );
  });

  it('ignores servers without an npm package', () => {
    expect(npmMcpNameIssues({ ...validServerJson, packages: undefined }, {})).toEqual([]);
  });
});
