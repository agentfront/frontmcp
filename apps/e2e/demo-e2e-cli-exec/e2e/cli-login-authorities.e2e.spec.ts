/**
 * E2E: the token a user stores with `connect --token` (as `login` does) is the caller authorization sees. The
 * server verifies it as an HTTP Bearer token, in-process and through the daemon alike, so a bundle skill that
 * needs the `admin` role is listed for an admin token only, and a token the server did not sign fails the command.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { TestTokenFactory } from '@frontmcp/testing';
import { mkdtemp, rename, rm } from '@frontmcp/utils';

import { removeScratchProject } from './helpers/dev-cli';
import { runCliBundle, type CliResult } from './helpers/exec-cli';
import { buildSkilledCliProject, type SkilledCliProject } from './helpers/skilled-cli-project';

const APP_NAME = 'skilled-login';
const ISSUER = 'https://idp.example.test';
const AUDIENCE = 'billing-cli';

// The generated CLI keeps credentials in the macOS Keychain, which a test must not write to; elsewhere, in a file under HOME
const describeWithFileCredentials = process.platform === 'darwin' ? describe.skip : describe;

describeWithFileCredentials('a logged-in CLI caller is the caller authorization sees', () => {
  const tokens = new TestTokenFactory({ issuer: ISSUER, audience: AUDIENCE });
  let project: SkilledCliProject;
  let homeDir: string;

  function run(args: string[]): CliResult {
    return runCliBundle(project.cliBundle, args, { HOME: homeDir, FRONTMCP_HOME: homeDir });
  }

  async function logInAs(roles: string[]): Promise<void> {
    const token = await tokens.createTestToken({ sub: `user-${roles.join('-')}`, claims: { roles } });
    expect(run(['connect', '--token', token])).toMatchObject({ exitCode: 0 });
  }

  beforeAll(async () => {
    const jwks = await tokens.getPublicJwks();
    project = await buildSkilledCliProject({
      prefix: 'skilled-login',
      appName: APP_NAME,
      cli: { authRequired: true },
      serverConfig: `auth: {
    mode: 'transparent',
    provider: ${JSON.stringify(ISSUER)},
    providerConfig: { jwks: ${JSON.stringify(jwks)} },
    expectedAudience: ${JSON.stringify(AUDIENCE)},
  },`,
    });
    // Short: the daemon's socket path must fit the platform's limit
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-login-'));
  }, 180_000);

  afterAll(async () => {
    run(['daemon', 'stop']);
    await rm(homeDir, { recursive: true, force: true });
    await removeScratchProject(project.dir);
  });

  it("lists the admin skill for an admin's token", async () => {
    await logInAs(['admin']);

    const { stdout, exitCode } = run(['skills', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
    expect(stdout).toContain('Admin');
  });

  it("leaves the admin skill out for a viewer's token", async () => {
    await logInAs(['viewer']);

    const { stdout, exitCode } = run(['skills', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
    expect(stdout).not.toContain('Admin');
  });

  it('fails a command whose stored token the server did not sign', async () => {
    const stranger = new TestTokenFactory({ issuer: ISSUER, audience: AUDIENCE });
    const forged = await stranger.createTestToken({ sub: 'mallory', claims: { roles: ['admin'] } });
    expect(run(['connect', '--token', forged])).toMatchObject({ exitCode: 0 });

    const { stderr, exitCode } = run(['skills', 'list']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("The server's auth did not accept the auth token");
  });

  describe('through the daemon', () => {
    const movedBundlePath = () => `${project.bundlePath}.moved`;

    beforeAll(() => {
      expect(run(['daemon', 'start'])).toMatchObject({ exitCode: 0 });
    });

    afterAll(async () => {
      run(['daemon', 'stop']);
      await rename(movedBundlePath(), project.bundlePath).catch(() => undefined);
    });

    it('sends the stored token, so the daemon sees the same caller', async () => {
      await logInAs(['admin']);
      expect(run(['skills', 'list']).stdout).toContain('Admin');
      // Only the daemon still has the bundle: the commands below are its answers
      await rename(project.bundlePath, movedBundlePath());

      expect(run(['skills', 'list']).stdout).toContain('Admin');
      await logInAs(['viewer']);
      const viewerList = run(['skills', 'list']).stdout;
      expect(viewerList).toContain('Invoices');
      expect(viewerList).not.toContain('Admin');
    });
  });
});
