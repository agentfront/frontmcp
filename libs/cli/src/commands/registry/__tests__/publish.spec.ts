import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RegistryError } from '../errors';
import { formatProofRecord, generateRegistryKeyPair, parsePrivateKey } from '../keys';
import { publishToRegistry, type PublishOptions } from '../publish';
import { SERVER_JSON_SCHEMA_URL } from '../server-json';
import { setServerStatus } from '../status';

const loadEntryDecoratorInfo = jest.fn();
jest.mock('../../build/load-entry-config.js', () => ({ loadEntryDecoratorInfo }), { virtual: true });
jest.mock('dns/promises', () => ({ resolveTxt: jest.fn().mockResolvedValue([['v=spf1 -all']]) }));
let mockHomeDir = '';
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => mockHomeDir }));

const REGISTRY_URL = 'https://registry.test';
const REGISTRY_TOKEN = 'registry-token-for-tests';
const PROOF_URL = 'https://acme.com/.well-known/mcp-registry-auth';

const serverJson = {
  $schema: SERVER_JSON_SCHEMA_URL,
  name: 'com.acme/weather',
  description: 'Forecasts for any city',
  version: '1.2.0',
  remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.com/mcp' }],
};

interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

type Route = (request: RecordedRequest) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function problem(status: number, title: string, detail: string, errors?: Array<{ message: string }>): Response {
  return new Response(JSON.stringify({ title, status, detail, ...(errors && { errors }) }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

describe('frontmcp registry publish / status against a fake Registry', () => {
  const keyPair = generateRegistryKeyPair();
  const verifyingKey = crypto.createPublicKey(parsePrivateKey(keyPair.privateKeySeedHex));
  let projectDir: string;
  let requests: RecordedRequest[];
  let overrides: Route[];
  let fetchMock: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let cwdSpy: jest.SpyInstance;

  const registryRoutes: Route = (request) => {
    const body = request.body as Record<string, string>;
    switch (`${request.method} ${request.url}`) {
      case `GET ${PROOF_URL}`:
        return new Response(formatProofRecord(keyPair.publicKeyBase64));
      case `POST ${REGISTRY_URL}/v0.1/validate`:
        return json(200, { valid: true, issues: [] });
      case `POST ${REGISTRY_URL}/v0.1/auth/http`:
      case `POST ${REGISTRY_URL}/v0.1/auth/dns`: {
        const signature = Buffer.from(body['signed_timestamp'], 'hex');
        const verified = crypto.verify(null, Buffer.from(body['timestamp']), verifyingKey, signature);
        return verified
          ? json(200, { registry_token: REGISTRY_TOKEN, expires_at: 0 })
          : problem(401, 'Unauthorized', 'signature verification failed');
      }
      case `POST ${REGISTRY_URL}/v0.1/publish`:
        return json(200, {
          server: request.body,
          _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } },
        });
    }
    return undefined;
  };

  function requestTo(urlSuffix: string): RecordedRequest | undefined {
    return requests.find((request) => request.url.endsWith(urlSuffix));
  }

  function printed(): string {
    return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  function diagnostics(): string {
    return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  async function publish(options: Partial<PublishOptions> = {}): Promise<void> {
    await publishToRegistry({ auth: 'http', file: 'server.json', registry: REGISTRY_URL, ...options });
  }

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-publish-'));
    fs.writeFileSync(path.join(projectDir, 'server.json'), JSON.stringify(serverJson));
    requests = [];
    overrides = [];
    process.env['MCP_REGISTRY_PRIVATE_KEY'] = keyPair.privateKeySeedHex;
    mockHomeDir = projectDir;
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(projectDir);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request: RecordedRequest = {
        method: init?.method ?? 'GET',
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      requests.push(request);
      for (const route of [...overrides, registryRoutes]) {
        const response = route(request);
        if (response) return response;
      }
      return problem(404, 'Not Found', `no route for ${request.method} ${request.url}`);
    });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    cwdSpy.mockRestore();
    delete process.env['MCP_REGISTRY_PRIVATE_KEY'];
    delete process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    delete process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('validates, preflights the proof, logs in with a signed timestamp, and publishes', async () => {
    await publish();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${REGISTRY_URL}/v0.1/validate`,
      `GET ${PROOF_URL}`,
      `POST ${REGISTRY_URL}/v0.1/auth/http`,
      `POST ${REGISTRY_URL}/v0.1/publish`,
    ]);
    const login = requestTo('/v0.1/auth/http')?.body as Record<string, string>;
    expect(Object.keys(login).sort()).toEqual(['domain', 'signed_timestamp', 'timestamp']);
    expect(login['domain']).toBe('acme.com');
    expect(login['timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(login['signed_timestamp']).toMatch(/^[0-9a-f]{128}$/);

    const publishRequest = requestTo('/v0.1/publish');
    expect(publishRequest?.headers.get('authorization')).toBe(`Bearer ${REGISTRY_TOKEN}`);
    expect(publishRequest?.body).toEqual(serverJson);

    const output = printed();
    expect(output).toContain('Published com.acme/weather@1.2.0 to https://registry.test (isLatest: true).');
    expect(output).toContain(`${REGISTRY_URL}/v0.1/servers?search=com.acme%2Fweather`);
    for (const text of [output, diagnostics()]) {
      expect(text).not.toContain(REGISTRY_TOKEN);
      expect(text).not.toContain(keyPair.privateKeySeedHex);
    }
  });

  it('prints only server.json on stdout for --dry-run, the diagnostics on stderr, and never logs in', async () => {
    await publish({ dryRun: true });

    expect(requests.map((request) => request.url)).toEqual([`${REGISTRY_URL}/v0.1/validate`]);
    expect(logSpy.mock.calls).toEqual([[JSON.stringify(serverJson, null, 2)]]);
    expect(diagnostics()).toContain('server.json passes the local checks.');
    expect(diagnostics()).toContain(`${REGISTRY_URL}/v0.1/validate accepts server.json.`);
    expect(diagnostics()).toContain('Dry run: com.acme/weather@1.2.0 was not published.');
  });

  it('publishes the server.json that --dry-run wrote to stdout, given back with --file', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: '@acme/weather', version: '1.2.0' }),
    );
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(path.join(projectDir, 'src', 'main.ts'), 'export default {};');
    loadEntryDecoratorInfo.mockResolvedValue({
      decoratorConfig: {
        info: { name: 'weather', version: '1.2.0', icons: [{ src: 'http://acme.com/icon.png' }] },
        registry: { name: 'com.acme/weather', description: 'Forecasts for any city' },
      },
      keysSeenInSource: [],
    });

    await publishToRegistry({ auth: 'http', dryRun: true, url: 'https://mcp.acme.com/mcp', registry: REGISTRY_URL });
    const stdout = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(diagnostics()).toContain('Left out the icon http://acme.com/icon.png: the Registry lists only https icons.');
    fs.writeFileSync(path.join(projectDir, 'dry-run.json'), `${stdout}\n`);
    logSpy.mockClear();

    await publish({ file: 'dry-run.json' });

    expect(requestTo('/v0.1/publish')?.body).toEqual(JSON.parse(stdout));
    expect(printed()).toContain('Published com.acme/weather@1.2.0');
  });

  it('explains a 403 namespace rejection', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(
            403,
            'Forbidden',
            'You do not have permission to publish this server. You have permission to publish: com.other/*',
          )
        : undefined,
    );
    const failure = publish();
    await expect(failure).rejects.toThrow(RegistryError);
    await expect(failure).rejects.toThrow(
      /403 Forbidden: You do not have permission[\s\S]*does not cover com\.acme\/weather/,
    );
  });

  it('explains a duplicate version', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(400, 'Bad Request', 'Failed to publish server', [
            { message: 'invalid version: cannot publish duplicate version: com.acme/weather@1.2.0 already exists' },
          ])
        : undefined,
    );
    await expect(publish()).rejects.toThrow(/cannot publish duplicate version[\s\S]*Bump the version/);
  });

  it('explains the npm mcpName requirement', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(400, 'Bad Request', 'Failed to publish server', [
            { message: "NPM package '@acme/weather' is missing required 'mcpName' field." },
          ])
        : undefined,
    );
    await expect(publish()).rejects.toThrow(/add "mcpName": "com.acme\/weather" to package.json/);
  });

  it('explains a 422 validation rejection', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(422, 'Unprocessable Entity', 'Failed to publish server, invalid schema: call /validate for details')
        : undefined,
    );
    await expect(publish()).rejects.toThrow(/422 Unprocessable Entity[\s\S]*--dry-run/);
  });

  it('explains an expired token and a remote URL another server owns', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(401, 'Unauthorized', 'Invalid or expired Registry JWT token')
        : undefined,
    );
    await expect(publish()).rejects.toThrow(/401 Unauthorized[\s\S]*it lasts 5 minutes/);

    overrides.unshift((request) =>
      request.url.endsWith('/v0.1/publish')
        ? problem(400, 'Bad Request', 'Failed to publish server', [
            { message: 'remote URL https://mcp.acme.com/mcp is already used by server com.other/weather' },
          ])
        : undefined,
    );
    await expect(publish()).rejects.toThrow(/already used by server com\.other\/weather[\s\S]*Publish under that name/);
  });

  it('shows a problem response from the validate endpoint', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/validate')
        ? problem(422, 'Unprocessable Entity', 'validation failed', [{ message: 'expected string' }])
        : undefined,
    );
    await expect(publish({ dryRun: true })).rejects.toThrow(
      /422 Unprocessable Entity: validation failed\n {2}- expected string/,
    );
  });

  it('shows the Registry validation issues and stops before logging in', async () => {
    overrides.push((request) =>
      request.url.endsWith('/v0.1/validate')
        ? json(200, {
            valid: false,
            issues: [
              {
                type: 'semantic',
                path: 'remotes[0].url',
                message: 'invalid remote URL',
                severity: 'error',
                reference: 'r',
              },
            ],
          })
        : undefined,
    );
    await expect(publish()).rejects.toThrow(
      /v0\.1\/validate rejected server\.json:\n {2}\[error\] remotes\[0\]\.url: invalid remote URL/,
    );
    expect(requestTo('/v0.1/auth/http')).toBeUndefined();
  });

  it('stops on local validation issues before any request', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'server.json'),
      JSON.stringify({ ...serverJson, version: 'latest', extra: 1 }),
    );
    await expect(publish()).rejects.toThrow(/server\.json is not valid:\n {2}\(top level\): .*extra/);
    expect(requests).toEqual([]);
  });

  it('stops before logging in when the HTTP proof is not ready', async () => {
    overrides.push((request) => (request.url === PROOF_URL ? new Response('missing', { status: 404 }) : undefined));
    await expect(publish()).rejects.toThrow(/The HTTP proof is not ready: .*answered 404/);
    expect(requestTo('/v0.1/auth/http')).toBeUndefined();
  });

  it('refuses a domain whose HTTP proof cannot grant the namespace', async () => {
    await expect(publish({ domain: 'mcp.acme.com' })).rejects.toThrow(
      'An HTTP proof on mcp.acme.com grants com.acme.mcp/* only, not com.acme/weather. Pass --domain acme.com, ' +
        'or use --auth dns on the parent domain to cover subdomains.',
    );
  });

  it('logs in with the DNS proof, which also covers subdomains, and only warns when the TXT record is not visible', async () => {
    const subdomainServer = { ...serverJson, name: 'com.acme.mcp/weather' };
    fs.writeFileSync(path.join(projectDir, 'server.json'), JSON.stringify(subdomainServer));

    await publish({ auth: 'dns', domain: 'acme.com' });

    expect(requestTo('/v0.1/auth/dns')?.body).toEqual(expect.objectContaining({ domain: 'acme.com' }));
    expect(requestTo('/.well-known/mcp-registry-auth')).toBeUndefined();
    expect(diagnostics()).toContain('DNS proof: acme.com (DNS TXT) has no "v=MCPv1');
    expect(printed()).toContain('Published com.acme.mcp/weather@1.2.0');
  });

  it('reads the private key from --key-file', async () => {
    delete process.env['MCP_REGISTRY_PRIVATE_KEY'];
    fs.writeFileSync(path.join(projectDir, 'registry.key'), `${keyPair.privateKeySeedHex}\n`);
    await publish({ keyFile: 'registry.key' });
    expect(printed()).toContain('Published com.acme/weather@1.2.0');
    const keygenFile = path.join(projectDir, '.frontmcp', 'keys', 'mcp-registry.key');
    await expect(publish()).rejects.toThrow(
      `No private key: pass --key-file <path>, set MCP_REGISTRY_PRIVATE_KEY, or create ${keygenFile} with frontmcp registry keygen.`,
    );
    await expect(publish({ keyFile: 'missing.key' })).rejects.toThrow(
      `Key file not found: ${path.join(projectDir, 'missing.key')}`,
    );
  });

  it("falls back to keygen's default key file", async () => {
    delete process.env['MCP_REGISTRY_PRIVATE_KEY'];
    fs.mkdirSync(path.join(projectDir, '.frontmcp', 'keys'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.frontmcp', 'keys', 'mcp-registry.key'), keyPair.privateKeySeedHex);

    await publish();

    expect(printed()).toContain('Published com.acme/weather@1.2.0');
  });

  it('logs in with a GitHub Actions ID token for io.github names', async () => {
    const githubServer = { ...serverJson, name: 'io.github.acme/weather' };
    fs.writeFileSync(path.join(projectDir, 'server.json'), JSON.stringify(githubServer));
    process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://actions.test/token?api-version=2.0';
    process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'actions-request-token';
    overrides.push((request) => {
      if (request.url.startsWith('https://actions.test/token')) return json(200, { value: 'github-id-token' });
      if (request.url.endsWith('/v0.1/auth/github-oidc'))
        return json(200, { registry_token: REGISTRY_TOKEN, expires_at: 0 });
      return undefined;
    });

    await publish({ auth: 'github-oidc' });

    const idTokenRequest = requests.find((request) => request.url.startsWith('https://actions.test/token'));
    expect(new URL(idTokenRequest?.url ?? '').searchParams.get('audience')).toBe(REGISTRY_URL);
    expect(idTokenRequest?.headers.get('authorization')).toBe('Bearer actions-request-token');
    expect(requestTo('/v0.1/auth/github-oidc')?.body).toEqual({ oidc_token: 'github-id-token' });
    expect(requestTo('/v0.1/publish')?.body).toEqual(githubServer);
  });

  it('refuses github-oidc for names outside io.github, and outside GitHub Actions', async () => {
    await expect(publish({ auth: 'github-oidc' })).rejects.toThrow(/GitHub OIDC grants io\.github\.<owner>\/\* only/);
    fs.writeFileSync(
      path.join(projectDir, 'server.json'),
      JSON.stringify({ ...serverJson, name: 'io.github.acme/weather' }),
    );
    await expect(publish({ auth: 'github-oidc' })).rejects.toThrow(/works only in GitHub Actions/);
  });

  it('builds server.json from @FrontMcp(), package.json and the frontmcp.config registry block', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: '@acme/weather', version: '1.2.0', mcpName: 'com.acme/weather' }),
    );
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(path.join(projectDir, 'src', 'main.ts'), 'export default {};');
    fs.writeFileSync(
      path.join(projectDir, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'weather',
        deployments: [{ target: 'node' }],
        registry: { url: 'https://mcp.acme.com/mcp', packages: ['npm'], registryUrl: REGISTRY_URL },
      }),
    );
    loadEntryDecoratorInfo.mockResolvedValue({
      decoratorConfig: {
        info: { name: 'weather', version: '1.2.0' },
        registry: { name: 'com.acme/weather', description: 'Forecasts for any city' },
      },
      keysSeenInSource: [],
    });

    await publishToRegistry({ auth: 'http', dryRun: true });

    expect(loadEntryDecoratorInfo).toHaveBeenCalledWith(path.join(projectDir, 'src', 'main.ts'));
    expect(requestTo('/v0.1/validate')?.body).toEqual({
      ...serverJson,
      packages: [{ registryType: 'npm', identifier: '@acme/weather', version: '1.2.0', transport: { type: 'stdio' } }],
    });
  });

  it('says why the entry could not be read', async () => {
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(path.join(projectDir, 'src', 'main.ts'), 'export default {};');
    loadEntryDecoratorInfo.mockResolvedValue({ decoratorConfig: undefined, keysSeenInSource: [], loadError: 'boom' });
    await expect(publishToRegistry({ auth: 'http', dryRun: true })).rejects.toThrow(
      `Could not read @FrontMcp() from ${path.join('src', 'main.ts')}: boom`,
    );
  });

  describe('status', () => {
    beforeEach(() => {
      overrides.push((request) => {
        if (request.method !== 'PATCH') return undefined;
        return request.url.includes('/versions/')
          ? json(200, { server: serverJson, _meta: {} })
          : json(200, { updatedCount: 3, servers: [] });
      });
    });

    it('sets one version, URL-encoding the name and version', async () => {
      await setServerStatus({
        status: 'deprecated',
        serverVersion: '1.2.0',
        message: 'Use 2.x',
        name: 'com.acme/weather',
        auth: 'http',
        registry: REGISTRY_URL,
      });
      const patch = requests.find((request) => request.method === 'PATCH');
      expect(patch?.url).toBe(`${REGISTRY_URL}/v0.1/servers/com.acme%2Fweather/versions/1.2.0/status`);
      expect(patch?.body).toEqual({ status: 'deprecated', statusMessage: 'Use 2.x' });
      expect(patch?.headers.get('authorization')).toBe(`Bearer ${REGISTRY_TOKEN}`);
      expect(printed()).toContain('com.acme/weather@1.2.0 is now deprecated.');
    });

    it('sets every version with --all-versions', async () => {
      await setServerStatus({
        status: 'deleted',
        allVersions: true,
        name: 'com.acme/weather',
        auth: 'http',
        registry: REGISTRY_URL,
      });
      const patch = requests.find((request) => request.method === 'PATCH');
      expect(patch?.url).toBe(`${REGISTRY_URL}/v0.1/servers/com.acme%2Fweather/status`);
      expect(patch?.body).toEqual({ status: 'deleted' });
      expect(printed()).toContain('3 version(s) of com.acme/weather are now deleted.');
    });

    it('needs exactly one of --server-version and --all-versions', async () => {
      const base = { status: 'deprecated' as const, name: 'com.acme/weather', auth: 'http' as const };
      await expect(setServerStatus(base)).rejects.toThrow(
        'Pass --server-version <version> to change one version, or --all-versions to change every version.',
      );
      await expect(setServerStatus({ ...base, serverVersion: '1.2.0', allVersions: true })).rejects.toThrow(
        'Pass --server-version <version> or --all-versions, not both.',
      );
      expect(requests).toEqual([]);
    });

    it('limits the message to 500 characters', async () => {
      await expect(
        setServerStatus({
          status: 'deprecated',
          allVersions: true,
          message: 'x'.repeat(501),
          name: 'com.acme/weather',
          auth: 'http',
        }),
      ).rejects.toThrow('--message must be at most 500 characters.');
    });

    it('rejects a message with active before logging in', async () => {
      await expect(
        setServerStatus({
          status: 'active',
          allVersions: true,
          message: 'back',
          name: 'com.acme/weather',
          auth: 'http',
          registry: REGISTRY_URL,
        }),
      ).rejects.toThrow(/--message goes with deprecated or deleted/);
      expect(requests).toEqual([]);
    });
  });
});
