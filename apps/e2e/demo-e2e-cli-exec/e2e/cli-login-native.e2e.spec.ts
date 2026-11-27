/**
 * E2E: with `cli.oauth.nativeSignIn`, the built CLI's `login` signs in with `signInNative` (#1361): it finds the
 * identity provider's endpoints in its metadata, sends S256 PKCE and the configured `resource`, and keeps the
 * tokens in the credential store. A command refreshes a token about to expire before it calls the server.
 * The test plays the browser: it follows the URL `login --no-browser` prints. The CLI runs asynchronously, so the
 * mock provider in this process can answer it.
 */
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { MockOAuthServer, TestTokenFactory } from '@frontmcp/testing';
import { decryptAesGcm, mkdtemp, readFile, rm, sha256 } from '@frontmcp/utils';

import { createScratchProject, removeScratchProject } from './helpers/dev-cli';
import { runCliBundleAsync, runFrontmcpCliAsync, type CliResult } from './helpers/exec-cli';

const APP_NAME = 'native-login';
const CLIENT_ID = 'native-login-cli';
const RESOURCE = 'https://tasks.example.test/mcp';

// The generated CLI keeps credentials in the macOS Keychain, which a test must not write to; elsewhere, in a file under HOME
const describeWithFileCredentials = process.platform === 'darwin' ? describe.skip : describe;

describeWithFileCredentials('login with cli.oauth.nativeSignIn', () => {
  let mockOAuth: MockOAuthServer;
  let issuer: string;
  let projectDir: string;
  let cliBundle: string;
  let homeDir: string;
  const authorizeUrls: URL[] = [];

  const env = () => ({ HOME: homeDir, FRONTMCP_HOME: path.join(homeDir, '.frontmcp') });

  /** The stored credential of the default session, decrypted as the generated file store does. */
  async function storedCredential(): Promise<{ token: string; metadata: { nativeTokens: { refreshToken: string } } }> {
    const file = path.join(homeDir, '.frontmcp', 'apps', APP_NAME, 'credentials', 'default.enc');
    const sealed = Buffer.from(await readFile(file), 'base64');
    const key = sha256(`${APP_NAME}:${os.hostname()}`);
    const plain = decryptAesGcm(key, sealed.subarray(28), sealed.subarray(0, 12), sealed.subarray(12, 28));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function login(): Promise<CliResult & { browserError?: unknown }> {
    return new Promise((resolve) => {
      const child = spawn('node', [cliBundle, 'login', '--no-browser'], {
        cwd: path.dirname(cliBundle),
        env: { ...process.env, NODE_ENV: 'test', ...env() },
      });
      let stdout = '';
      let stderr = '';
      let browserError: unknown;
      let browsed = false;
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        const url = /Open this URL in your browser:\s+(\S+)/.exec(stdout)?.[1];
        if (!url || browsed) return;
        browsed = true;
        authorizeUrls.push(new URL(url));
        fetch(url, { redirect: 'manual' })
          .then((approved) => fetch(approved.headers.get('location') as string))
          .catch((error: unknown) => (browserError = error));
      });
      child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1, browserError });
      });
    });
  }

  beforeAll(async () => {
    const probe = new MockOAuthServer(new TestTokenFactory());
    const { port } = await probe.start();
    await probe.stop();
    issuer = `http://localhost:${port}`;
    mockOAuth = new MockOAuthServer(new TestTokenFactory({ issuer, audience: issuer }), {
      port,
      autoApprove: true,
      testUser: { sub: 'native-user' },
      clientId: CLIENT_ID,
      validRedirectUris: ['http://127.0.0.1:*/callback'],
      pkce: 'strict',
      resourceIndicators: [RESOURCE],
      // Within the minute before expiry, so every command refreshes first
      accessTokenTtlSeconds: 30,
    });
    await mockOAuth.start();

    projectDir = await createScratchProject('native-login', {
      'src/main.ts': `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'whoami', description: 'The caller', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return 'sub=' + this.getAuthInfo()?.user?.sub;
  }
}

@App({ name: 'tasks', tools: [WhoAmITool] })
class TasksApp {}

@FrontMcp({
  info: { name: 'Native Login', version: '1.0.0' },
  apps: [TasksApp],
  auth: {
    mode: 'transparent',
    provider: ${JSON.stringify(issuer)},
    providerConfig: { dcrEnabled: false },
    expectedAudience: ${JSON.stringify(RESOURCE)},
  },
  logging: { level: LogLevel.Warn, enableConsole: false },
})
export default class Server {}
`,
      'frontmcp.config.js': `module.exports = {
  name: '${APP_NAME}',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [
    {
      target: 'cli',
      cli: {
        authRequired: true,
        oauth: { serverUrl: ${JSON.stringify(issuer)}, clientId: '${CLIENT_ID}', defaultScope: 'openid tasks', nativeSignIn: true, resource: '${RESOURCE}' },
      },
    },
  ],
};\n`,
    });
    const build = await runFrontmcpCliAsync(['build', '--target', 'cli', '--js'], projectDir, 150_000);
    if (build.exitCode !== 0) throw new Error(`The ${APP_NAME} build failed:\n${build.stdout}${build.stderr}`);
    cliBundle = path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`);
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-native-login-'));
  }, 180_000);

  afterAll(async () => {
    await mockOAuth?.stop();
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    if (projectDir) await removeScratchProject(projectDir);
  });

  it('signs in at the discovered endpoints with S256 PKCE, the resource and a loopback redirect', async () => {
    const result = await login();

    expect(result).toMatchObject({ exitCode: 0, browserError: undefined });
    expect(result.stdout).toContain('Logged in successfully. Session: default');
    const query = authorizeUrls[0].searchParams;
    expect(`${authorizeUrls[0].origin}${authorizeUrls[0].pathname}`).toBe(`${issuer}/oauth/authorize`);
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('resource')).toBe(RESOURCE);
    expect(query.get('scope')).toBe('openid tasks');
    expect(query.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:178[3-5]\d\/callback$/);
    expect((await storedCredential()).metadata.nativeTokens.refreshToken).toBeDefined();
  });

  it('refreshes the token before a command, which the server then accepts', async () => {
    const before = await storedCredential();

    const { stdout, stderr, exitCode } = await runCliBundleAsync(cliBundle, ['whoami'], env());

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
    expect(stdout).toContain('sub=native-user');
    const after = await storedCredential();
    expect(after.metadata.nativeTokens.refreshToken).not.toBe(before.metadata.nativeTokens.refreshToken);
  });

  it('asks to log in again once the provider refuses the refresh token', async () => {
    mockOAuth.clearStoredTokens();

    const { stderr, exitCode } = await runCliBundleAsync(cliBundle, ['whoami'], env());

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`The session expired. Run "${APP_NAME} login" again.`);
  });
});
