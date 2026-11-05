/**
 * OAuth Connect Flow Tests (Checkpoint 3b)
 *
 * Focused coverage for the mid-session add-credential flow (`/oauth/connect`):
 *   - GET with a valid framework-signed token renders the single-field page
 *   - missing / invalid / tampered tokens are rejected (400)
 *   - POST with a live vault re-invokes authenticate({ resume }) and ADDS the
 *     credential to the existing vault
 *   - POST for a signed subject with no vault yet creates that subject's vault
 *   - a link signed for an anonymous caller is refused (403), and no vault is made
 *
 * Crypto + the resume-link round-trip are exercised against a real
 * SessionCredentialVault + MemoryStorageAdapter.
 */
import 'reflect-metadata';

import { SessionCredentialVault, signCredentialResumeToken } from '@frontmcp/auth';
import { MemoryStorageAdapter } from '@frontmcp/utils';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { HttpHtmlSchema, httpInputSchema, type FlowMetadata } from '../../../common';
import OauthConnectFlow from '../oauth.connect.flow';

const SECRET = 'connect-flow-secret-32-bytes-minimum';
const PEPPER = 'connect-flow-pepper-32-bytes-minimum';

function createConnectMetadata(): FlowMetadata<'oauth:connect'> {
  return {
    name: 'oauth:connect',
    plan: { pre: ['parseInput'], execute: ['handleConnect'] },
    inputSchema: httpInputSchema,
    outputSchema: HttpHtmlSchema,
    access: 'public',
    middleware: { path: '/oauth/connect' },
  } as FlowMetadata<'oauth:connect'>;
}

/**
 * Build a scope whose auth exposes the server `secret`, a live
 * SessionCredentialVault, and an optional `authenticate` verifier + `login`.
 */
async function makeScope(opts: {
  authenticate?: jest.Mock;
  login?: unknown;
  seedSub?: string;
}): Promise<{ scope: any; vault: SessionCredentialVault; adapter: MemoryStorageAdapter }> {
  const adapter = new MemoryStorageAdapter();
  await adapter.connect();
  const vault = new SessionCredentialVault({ storage: adapter, pepper: PEPPER });
  if (opts.seedSub) {
    // Give the subject a LIVE vault (as a prior login would).
    await vault.rotateVault(opts.seedSub);
  }

  const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
  // Patch the mock auth with the fields the connect flow reads.
  Object.assign(scope.auth, {
    secret: new TextEncoder().encode(SECRET),
    credentialVault: vault,
    options: { mode: 'local', authenticate: opts.authenticate, login: opts.login },
  });
  return { scope, vault, adapter };
}

function token(sub: string, key: string, context?: string): string {
  return signCredentialResumeToken({ sub, key, context }, SECRET);
}

function withSignedSubjectReplaced(signedToken: string, sub: string): string {
  const envelope = JSON.parse(Buffer.from(signedToken, 'base64url').toString('utf8'));
  envelope.data.sub = sub;
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function connectFlow(scope: any, request: Parameters<typeof createMockHttpRequest>[0]): OauthConnectFlow {
  const input = createMockHttpRequest({ path: '/oauth/connect', ...request });
  return new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
}

async function connect(scope: any, request: Parameters<typeof createMockHttpRequest>[0]) {
  const { output } = await runFlowStages(connectFlow(scope, request), ['parseInput', 'handleConnect']);
  return output;
}

describe('OAuth Connect Flow (Checkpoint 3b)', () => {
  it('rejects a missing token with 400', async () => {
    const { scope, adapter } = await makeScope({});
    const input = createMockHttpRequest({ method: 'GET', path: '/oauth/connect', query: {} });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);
    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    await adapter.disconnect();
  });

  it('rejects an invalid/tampered token with 400', async () => {
    const { scope, adapter } = await makeScope({ seedSub: 'user-1' });
    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/connect',
      query: { token: `${token('user-1', 'acme')}tampered` },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);
    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    await adapter.disconnect();
  });

  it('GET renders the single-field connect page for a valid token', async () => {
    const { scope, adapter } = await makeScope({
      seedSub: 'user-1',
      login: { fields: { apiKey: { type: 'password', label: 'API Key', required: true } } },
    });
    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/connect',
      query: { token: token('user-1', 'acme') },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);
    expect(output?.kind).toBe('html');
    const html = String(output?.body);
    expect(html).toContain('name="token"');
    expect(html).toContain('name="apiKey"');
    expect(html).toContain('Connect');
    await adapter.disconnect();
  });

  it('POST with a live vault adds the credential via authenticate({ resume })', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
    const { scope, vault, adapter } = await makeScope({ seedSub: 'user-1', authenticate });

    const input = createMockHttpRequest({
      method: 'POST',
      path: '/oauth/connect',
      body: { token: token('user-1', 'acme', 'ctx-1'), apiKey: 'sk-new' },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);

    // Verifier received the resume context.
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate.mock.calls[0][0]).toEqual({
      fields: { apiKey: 'sk-new' },
      resume: { sub: 'user-1', key: 'acme', context: 'ctx-1' },
    });
    // Success page + credential added to the existing vault.
    expect(output?.kind).toBe('html');
    expect(String(output?.body).toLowerCase()).toContain('connected');
    expect(await vault.get('user-1', 'acme')).toEqual({ secret: 'sk-new' });
    await adapter.disconnect();
  });

  it('POST with a live vault keeps that vault and the credentials already in it', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
    const { scope, vault, adapter } = await makeScope({ authenticate });
    const vaultIdBefore = await vault.rotateVault('user-1');
    await vault.store('user-1', vaultIdBefore, 'globex', { secret: 'sk-globex' });

    await connect(scope, { method: 'POST', body: { token: token('user-1', 'acme'), apiKey: 'sk-new' } });

    expect(await vault.getVaultId('user-1')).toBe(vaultIdBefore);
    expect(await vault.get('user-1', 'globex')).toEqual({ secret: 'sk-globex' });
    expect((await vault.list('user-1')).sort()).toEqual(['acme', 'globex']);
    await adapter.disconnect();
  });

  it('POST reports the added credential to callers subscribed to its credential:// resource', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
    const { scope, adapter } = await makeScope({ seedSub: 'user-1', authenticate });
    const notifyContentChanged = jest.fn();
    Object.assign(scope, { resources: { notifyContentChanged } });

    const input = createMockHttpRequest({
      method: 'POST',
      path: '/oauth/connect',
      body: { token: token('user-1', 'acme', 'ctx-1'), apiKey: 'sk-new' },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    await runFlowStages(flow, ['parseInput', 'handleConnect']);

    expect(notifyContentChanged).toHaveBeenCalledWith('credential://acme');
    await adapter.disconnect();
  });

  describe('a signed subject with no vault yet', () => {
    it('POST creates the vault for that subject and stores the credential', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate });
      expect(await vault.getVaultId('user-without-vault')).toBeUndefined();

      const output = await connect(scope, {
        method: 'POST',
        body: { token: token('user-without-vault', 'acme'), apiKey: 'sk-new' },
      });

      expect(output?.status).toBe(200);
      expect(String(output?.body).toLowerCase()).toContain('connected');
      expect(await vault.getVaultId('user-without-vault')).toEqual(expect.any(String));
      expect(await vault.get('user-without-vault', 'acme')).toEqual({ secret: 'sk-new' });
      expect(await vault.list('user-without-vault')).toEqual(['acme']);
      await adapter.disconnect();
    });

    it('GET still renders the connect page', async () => {
      const { scope, adapter } = await makeScope({});
      const output = await connect(scope, { method: 'GET', query: { token: token('user-without-vault', 'acme') } });
      expect(output?.status).toBe(200);
      expect(String(output?.body)).toContain('name="token"');
      await adapter.disconnect();
    });

    it('creates a vault for the signed subject only, leaving another subject vault as it was', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate });
      const otherVaultId = await vault.rotateVault('other-user');
      await vault.store('other-user', otherVaultId, 'globex', { secret: 'sk-other' });

      await connect(scope, { method: 'POST', body: { token: token('user-without-vault', 'acme'), apiKey: 'sk-new' } });

      expect(await vault.getVaultId('other-user')).toBe(otherVaultId);
      expect(await vault.list('other-user')).toEqual(['globex']);
      expect(await vault.get('other-user', 'acme')).toBeUndefined();
      expect(await vault.list('user-without-vault')).toEqual(['acme']);
      await adapter.disconnect();
    });

    it('two connects at once write into one vault, so each credential stays readable', async () => {
      const authenticate = jest.fn().mockImplementation(async (input: { resume: { key: string } }) => ({
        ok: true,
        credentials: [{ key: input.resume.key, secret: `${input.resume.key}-secret` }],
      }));
      const { scope, vault, adapter } = await makeScope({ authenticate });

      await Promise.all([
        connect(scope, { method: 'POST', body: { token: token('user-without-vault', 'acme'), apiKey: 'a' } }),
        connect(scope, { method: 'POST', body: { token: token('user-without-vault', 'globex'), apiKey: 'b' } }),
      ]);

      expect(await vault.get('user-without-vault', 'acme')).toEqual({ secret: 'acme-secret' });
      expect(await vault.get('user-without-vault', 'globex')).toEqual({ secret: 'globex-secret' });
      await adapter.disconnect();
    });

    it('creates no vault when every returned credential is malformed', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme' }, { secret: 'x' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate });

      const output = await connect(scope, {
        method: 'POST',
        body: { token: token('user-without-vault', 'acme'), apiKey: 'sk-new' },
      });

      expect(output?.status).toBe(400);
      expect(String(output?.body)).toContain('No valid credential was returned');
      expect(await vault.getVaultId('user-without-vault')).toBeUndefined();
      await adapter.disconnect();
    });

    it('creates no vault when authenticate() rejects the submitted value', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: false, message: 'Invalid value' });
      const { scope, vault, adapter } = await makeScope({ authenticate });

      const output = await connect(scope, {
        method: 'POST',
        body: { token: token('user-without-vault', 'acme'), apiKey: 'wrong' },
      });

      expect(String(output?.body)).toContain('Invalid value');
      expect(await vault.getVaultId('user-without-vault')).toBeUndefined();
      await adapter.disconnect();
    });
  });

  describe('a link signed for an anonymous caller', () => {
    it.each([
      ['an empty subject', ''],
      ['an anon: placeholder', 'anon:4f1c2b'],
    ])('with %s is refused on GET and POST, asking the caller to sign in', async (_label, anonymousSub) => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate });
      const anonymousToken = token(anonymousSub, 'acme');

      const page = await connect(scope, { method: 'GET', query: { token: anonymousToken } });
      const submit = await connect(scope, { method: 'POST', body: { token: anonymousToken, apiKey: 'sk-new' } });

      for (const output of [page, submit]) {
        expect(output?.kind).toBe('html');
        expect(output?.status).toBe(403);
        expect(String(output?.body)).toContain('login_required');
        expect(String(output?.body)).toContain('Sign in to this server');
        expect(String(output?.body)).not.toContain('name="token"');
      }
      expect(authenticate).not.toHaveBeenCalled();
      expect(await vault.getVaultId(anonymousSub)).toBeUndefined();
      await adapter.disconnect();
    });
  });

  describe('a link whose signed subject was changed', () => {
    it('is refused, and neither subject gets a vault or a credential', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate, seedSub: 'victim-user' });
      const forgedToken = withSignedSubjectReplaced(token('attacker-user', 'acme'), 'victim-user');

      const output = await connect(scope, { method: 'POST', body: { token: forgedToken, apiKey: 'sk-new' } });

      expect(output?.status).toBe(400);
      expect(String(output?.body)).toContain('invalid_token');
      expect(authenticate).not.toHaveBeenCalled();
      expect(await vault.list('victim-user')).toEqual([]);
      expect(await vault.getVaultId('attacker-user')).toBeUndefined();
      await adapter.disconnect();
    });

    it('is refused when an anonymous link is rewritten to name a signed-in subject', async () => {
      const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
      const { scope, vault, adapter } = await makeScope({ authenticate });
      const forgedToken = withSignedSubjectReplaced(token('', 'acme'), 'user-without-vault');

      const output = await connect(scope, { method: 'POST', body: { token: forgedToken, apiKey: 'sk-new' } });

      expect(output?.status).toBe(400);
      expect(await vault.getVaultId('user-without-vault')).toBeUndefined();
      await adapter.disconnect();
    });
  });

  it('POST re-renders with the error when authenticate() rejects', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: false, message: 'Invalid value', retryField: 'apiKey' });
    const { scope, adapter } = await makeScope({
      seedSub: 'user-1',
      authenticate,
      login: { fields: { apiKey: { type: 'password', label: 'API Key' } } },
    });
    const input = createMockHttpRequest({
      method: 'POST',
      path: '/oauth/connect',
      body: { token: token('user-1', 'acme'), apiKey: 'wrong' },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);
    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Invalid value');
    await adapter.disconnect();
  });
});
