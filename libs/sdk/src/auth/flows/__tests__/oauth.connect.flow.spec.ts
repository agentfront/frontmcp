/**
 * OAuth Connect Flow Tests (Checkpoint 3b)
 *
 * Focused coverage for the mid-session add-credential flow (`/oauth/connect`):
 *   - GET with a valid framework-signed token renders the single-field page
 *   - missing / invalid / tampered tokens are rejected (400)
 *   - POST with a live vault re-invokes authenticate({ resume }) and ADDS the
 *     credential to the existing vault
 *   - POST with NO live vault for the subject is refused (409)
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

  it('POST is refused (409) when the subject has NO live vault', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true, credentials: [{ key: 'acme', secret: 'sk-new' }] });
    // No seedSub → the subject has no live vault.
    const { scope, adapter } = await makeScope({ authenticate });

    const input = createMockHttpRequest({
      method: 'POST',
      path: '/oauth/connect',
      body: { token: token('ghost-sub', 'acme'), apiKey: 'sk-new' },
    });
    const flow = new OauthConnectFlow(createConnectMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handleConnect']);
    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(409);
    await adapter.disconnect();
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
