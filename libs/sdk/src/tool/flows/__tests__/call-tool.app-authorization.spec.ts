/**
 * call-tool flow — progressive/incremental app-level authorization
 * (checkToolAuthorization stage).
 *
 * The verified token's `authorized_apps` claim gates which apps' tools may be
 * invoked. This claim is ONLY minted when `incrementalAuth` is enabled, so:
 * - a tool whose owner app IS in `authorized_apps` is allowed,
 * - a tool whose owner app is NOT in `authorized_apps` throws
 *   AuthorizationRequiredError (the gate),
 * - a token with NO `authorized_apps` claim allows everything (default
 *   preserved — non-incremental behavior is unchanged),
 * - an incremental authorize that expands the claim to include the app makes a
 *   previously-403'd tool succeed.
 */
import 'reflect-metadata';

import { createMockScopeEntry } from '../../../__test-utils__';
import { AuthorizationRequiredError } from '../../../errors';
import CallToolFlow from '../call-tool.flow';

const inputSchema = { parse: (v: unknown) => v } as any;
const outputSchema = { parse: (v: unknown) => v } as any;

function makeFlow(opts: {
  tool: { name: string; fullName: string; owner?: { id: string } };
  authInfo?: Record<string, unknown>;
  apps?: Array<{ id: string; name: string; auth?: { mode: string } }>;
  incrementalAuth?: { enabled?: boolean; skippedAppBehavior?: 'anonymous' | 'require-auth' };
}): CallToolFlow {
  const auth: any = { mode: 'local' };
  if (opts.incrementalAuth) auth.incrementalAuth = opts.incrementalAuth;
  const scope = createMockScopeEntry({ auth, apps: opts.apps });
  const metadata = {
    name: 'tools:call-tool',
    plan: { pre: ['checkToolAuthorization'], execute: [], finalize: [] },
    inputSchema,
    outputSchema,
    access: 'authorized',
  } as any;
  const rawInput = { request: { method: 'tools/call', params: {} }, ctx: {} };
  const flow = new CallToolFlow(metadata, rawInput, scope, jest.fn(), new Map());
  flow.state.set('tool', opts.tool as any);
  if (opts.authInfo) flow.state.set('authInfo', opts.authInfo as any);
  return flow;
}

const NOTES_TOOL = { name: 'create-note', fullName: 'notes:create-note', owner: { id: 'notes' } };
const TASKS_TOOL = { name: 'create-task', fullName: 'tasks:create-task', owner: { id: 'tasks' } };
const APPS = [
  { id: 'notes', name: 'Notes' },
  { id: 'tasks', name: 'Tasks' },
];

describe('call-tool app-level authorization (progressive/incremental)', () => {
  it('allows a tool whose owner app is in the authorized_apps claim', async () => {
    const flow = makeFlow({
      tool: NOTES_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { extra: { user: { sub: 'u1', authorized_apps: ['notes'] } } },
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('rejects a tool whose owner app is NOT in the authorized_apps claim (the gate)', async () => {
    const flow = makeFlow({
      tool: TASKS_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { extra: { user: { sub: 'u1', authorized_apps: ['notes'] } } },
    });
    await expect(flow.checkToolAuthorization()).rejects.toBeInstanceOf(AuthorizationRequiredError);
  });

  it('reads the claim from the bearer token when extra.user is absent (transport-agnostic)', async () => {
    // A JWT whose payload is { authorized_apps: ['notes'] } (no signature needed
    // — checkToolAuthorization decodes already-verified claims).
    const payload = Buffer.from(JSON.stringify({ authorized_apps: ['notes'] })).toString('base64url');
    const token = `aaa.${payload}.bbb`;
    const flow = makeFlow({
      tool: TASKS_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { token, extra: {} },
    });
    await expect(flow.checkToolAuthorization()).rejects.toBeInstanceOf(AuthorizationRequiredError);
  });

  it('after incremental expansion (claim includes the app), the previously-403 tool succeeds', async () => {
    // Same tasks tool, but now the (re-minted) token grants notes + tasks.
    const flow = makeFlow({
      tool: TASKS_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { extra: { user: { sub: 'u1', authorized_apps: ['notes', 'tasks'] } } },
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();

    // And app A (notes) still works with the same expanded token.
    const flowA = makeFlow({
      tool: NOTES_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { extra: { user: { sub: 'u1', authorized_apps: ['notes', 'tasks'] } } },
    });
    await expect(flowA.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('allows ALL tools when the token carries NO authorized_apps claim (default preserved)', async () => {
    const flow = makeFlow({
      tool: TASKS_TOOL,
      apps: APPS,
      incrementalAuth: { enabled: true },
      authInfo: { extra: { user: { sub: 'u1' } } }, // no authorized_apps claim
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('skips the check entirely when there is no auth context at all (public)', async () => {
    const flow = makeFlow({
      tool: TASKS_TOOL,
      apps: APPS,
      authInfo: undefined,
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('the gate error carries the AUTHORIZATION_REQUIRED shape (code + _meta)', () => {
    const err = new AuthorizationRequiredError({
      appId: 'tasks',
      toolId: 'tasks:create-task',
      authUrl: '/oauth/authorize?app=tasks',
    });
    expect(err.code).toBe('AUTHORIZATION_REQUIRED');
    expect(err.statusCode).toBe(403);
    const mcp = err.toMcpError();
    expect(mcp._meta.authorization_required).toBe(true);
    expect(mcp._meta.app).toBe('tasks');
    expect(mcp._meta.auth_url).toBe('/oauth/authorize?app=tasks');
    expect(mcp._meta.supports_incremental).toBe(true);
  });
});
