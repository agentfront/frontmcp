/**
 * call-tool flow — TOOL-LEVEL credential gate (checkToolCredentials stage).
 *
 * A tool's `authProviders` gate credential availability BEFORE execute():
 *  - a `required: true` provider with NO credential aborts with
 *    ToolCredentialsRequiredError (JSON-RPC -32001) carrying provider id(s)
 *    + an authUrl;
 *  - a provider whose credential IS present allows the call;
 *  - a `required: false` provider never gates (even when absent);
 *  - a tool with NO authProviders is unaffected (default preserved);
 *  - when NO credential accessor is wired the gate is a no-op (default
 *    preserved) — this is the common public/no-auth case;
 *  - trusted internal dispatch (`internalCall: true`) bypasses the gate;
 *  - the connect URL is in the error's data, never its message, and an
 *    anonymous caller gets signInRequired instead of a URL;
 *  - a client that declared URL-mode elicitation is asked to open the connect
 *    page, and the call runs when the credential is connected after it.
 *
 * The stage is invoked directly with a seeded tool context whose `tryGet`
 * resolves fake accessors, so the test never spawns a server and asserts no
 * secrets (no PII).
 */
import 'reflect-metadata';

import { AUTH_PROVIDERS_ACCESSOR, CREDENTIALS_ACCESSOR } from '@frontmcp/auth';
import type { Token } from '@frontmcp/di';

import { createMockScopeEntry } from '../../../__test-utils__';
import { ToolCredentialsRequiredError } from '../../../errors';
import CallToolFlow from '../call-tool.flow';

const inputSchema = { parse: (v: unknown) => v } as never;
const outputSchema = { parse: (v: unknown) => v } as never;

interface ToolStub {
  name: string;
  fullName: string;
  metadata: Record<string, unknown>;
}

/**
 * Build a fake tool context whose `tryGet(token)` returns a registered accessor
 * (or undefined for unregistered tokens — mirroring ExecutionContextBase.tryGet).
 */
function makeToolContext(registry: Map<Token, unknown>) {
  return {
    tryGet: <T>(token: Token<T>): T | undefined => registry.get(token) as T | undefined,
    mark: jest.fn(),
  };
}

function makeFlow(opts: {
  tool: ToolStub;
  accessors?: Map<Token, unknown>;
  ctx?: Record<string, unknown>;
  elicitation?: { clientCapabilities: Record<string, unknown>; elicit: jest.Mock };
}): CallToolFlow {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  const metadata = {
    name: 'tools:call-tool',
    plan: { pre: ['checkToolCredentials'], execute: [], finalize: [] },
    inputSchema,
    outputSchema,
    access: 'authorized',
  } as never;
  const rawInput = { request: { method: 'tools/call', params: {} }, ctx: opts.ctx ?? {} };
  const flow = new CallToolFlow(metadata, rawInput, scope, jest.fn(), new Map());
  flow.state.set('tool', opts.tool as never);
  // The gate reads the built tool context; seed one whose tryGet resolves the
  // provided accessors (empty registry ⇒ "no accessor wired").
  flow.state.set('toolContext', makeToolContext(opts.accessors ?? new Map()) as never);
  if (opts.elicitation) {
    const { clientCapabilities, elicit } = opts.elicitation;
    Object.assign(scope.metadata, { elicitation: { enabled: true } });
    Object.assign(scope, { notifications: { getClientCapabilities: () => clientCapabilities } });
    const context = { sessionId: 'session-1', transport: { elicit }, getPreResolvedElicitResult: () => undefined };
    jest.spyOn(flow as unknown as { tryGetContext: () => unknown }, 'tryGetContext').mockReturnValue(context);
  }
  return flow;
}

async function gateErrorOf(flow: CallToolFlow): Promise<ToolCredentialsRequiredError> {
  const error = await flow.checkToolCredentials().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ToolCredentialsRequiredError);
  return error as ToolCredentialsRequiredError;
}

const CONNECT_URL = 'https://server/oauth/connect?token=tok';
const URL_ELICITATION = { elicitation: { url: {} } };

/** A `this.credentials` accessor whose credentials connect when the client accepts the connect page. */
function credentialsConnectedOnAccept() {
  const connected: Record<string, boolean> = {};
  const accessor = {
    requireConnect: jest.fn(async ({ key }: { key: string }) =>
      connected[key] ? { connected: true } : { connected: false, resumeUrl: CONNECT_URL },
    ),
  };
  const elicit = jest.fn(async () => {
    connected['github'] = true;
    return { status: 'accept' };
  });
  return { accessors: new Map<Token, unknown>([[CREDENTIALS_ACCESSOR, accessor]]), elicit };
}

/** Fake `this.authProviders` accessor: `get(name)` resolves to a truthy cred or null. */
function authProvidersWith(available: Record<string, boolean>) {
  return {
    get: jest.fn(async (name: string) => (available[name] ? { credential: { type: 'bearer' } } : null)),
  };
}

/** Fake `this.credentials` accessor backed by requireConnect. */
function credentialsWith(connected: Record<string, boolean>, resumeUrl = CONNECT_URL) {
  return {
    requireConnect: jest.fn(async ({ key }: { key: string }) =>
      connected[key] ? { connected: true } : { connected: false, resumeUrl },
    ),
  };
}

function withAuthProviders(available: Record<string, boolean>): Map<Token, unknown> {
  return new Map<Token, unknown>([[AUTH_PROVIDERS_ACCESSOR, authProvidersWith(available)]]);
}

function withCredentials(connected: Record<string, boolean>): Map<Token, unknown> {
  return new Map<Token, unknown>([[CREDENTIALS_ACCESSOR, credentialsWith(connected)]]);
}

const TOOL_BASE = { name: 'deploy', fullName: 'cloud:deploy' };

describe('call-tool credential gate (checkToolCredentials)', () => {
  it('aborts before execute when a required provider has no credential', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withAuthProviders({}),
    });

    await expect(flow.checkToolCredentials()).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
  });

  it('carries -32001 + provider id(s) + authUrl in the JSON-RPC error', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withCredentials({}),
    });

    let caught: ToolCredentialsRequiredError | undefined;
    try {
      await flow.checkToolCredentials();
    } catch (e) {
      caught = e as ToolCredentialsRequiredError;
    }
    expect(caught).toBeInstanceOf(ToolCredentialsRequiredError);
    const json = caught!.toJsonRpcError();
    expect(json.code).toBe(-32001);
    expect(json.data.tool).toBe('cloud:deploy');
    expect(json.data.providers).toEqual(['github']);
    // Both naming conventions are present and equal.
    expect(json.data.authUrl).toBe('https://server/oauth/connect?token=tok');
    expect(json.data.auth_url).toBe('https://server/oauth/connect?token=tok');
  });

  it('allows the call when the required provider credential is present (via authProviders)', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withAuthProviders({ github: true }),
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('allows the call when the required credential is present (via this.credentials)', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withCredentials({ github: true }),
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('does NOT gate a required:false provider even when its credential is absent', async () => {
    const flow = makeFlow({
      tool: {
        ...TOOL_BASE,
        metadata: { name: 'deploy', authProviders: [{ name: 'aws', required: false, alias: 'cloud' }] },
      },
      accessors: withAuthProviders({}),
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('gates only the missing required provider in a mixed required/optional set', async () => {
    const flow = makeFlow({
      tool: {
        ...TOOL_BASE,
        metadata: {
          name: 'deploy',
          authProviders: [
            { name: 'github', required: true, scopes: ['repo'] },
            { name: 'aws', required: false, alias: 'cloud' },
          ],
        },
      },
      accessors: withAuthProviders({ aws: true /* github missing */ }),
    });

    let caught: ToolCredentialsRequiredError | undefined;
    try {
      await flow.checkToolCredentials();
    } catch (e) {
      caught = e as ToolCredentialsRequiredError;
    }
    expect(caught).toBeInstanceOf(ToolCredentialsRequiredError);
    // Only github (required + missing) is reported; aws is optional.
    expect(caught!.toJsonRpcError().data.providers).toEqual(['github']);
  });

  it('is a no-op when the tool declares no authProviders (default preserved)', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy' } },
      accessors: withAuthProviders({}),
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('is a no-op when NO credential accessor is configured (public/no-auth — default preserved)', async () => {
    // Empty accessor registry → tryGet returns undefined for any token, so no
    // accessor resolves and the gate must NOT block a required provider.
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('bypasses the gate for trusted internal dispatch (internalCall: true)', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withAuthProviders({}),
      ctx: { internalCall: true },
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('bypasses the gate for the background task re-dispatch (ctx.taskId set)', async () => {
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors: withAuthProviders({}),
      ctx: { taskId: 'task_123' },
    });

    await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
  });

  it('keeps the connect URL out of the message, which names the provider to connect', async () => {
    const error = await gateErrorOf(
      makeFlow({
        tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
        accessors: withCredentials({}),
      }),
    );

    expect(error.message).not.toContain('http');
    expect(error.message).toContain("Connect github to continue: open the link in this error's data (authUrl).");
    expect(error.toJsonRpcError().data.authUrl).toBe(CONNECT_URL);
  });

  it('answers an anonymous caller with signInRequired and no connect URL', async () => {
    const anonymousCredentials = {
      requireConnect: jest.fn(async () => ({ connected: false, resumeUrl: '', signInRequired: true })),
    };
    const error = await gateErrorOf(
      makeFlow({
        tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
        accessors: new Map<Token, unknown>([[CREDENTIALS_ACCESSOR, anonymousCredentials]]),
      }),
    );

    expect(error.toJsonRpcError()).toEqual({
      code: -32001,
      message:
        'Tool "cloud:deploy" requires credentials for github, and this caller isn\'t signed in. ' +
        'Sign in to this server, then connect github.',
      data: { tool: 'cloud:deploy', providers: ['github'], signInRequired: true },
    });
  });

  describe('a client that declared URL-mode elicitation', () => {
    const tool = { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } };

    it('is asked to open the connect page, and the call runs once the credential is connected', async () => {
      const { accessors, elicit } = credentialsConnectedOnAccept();
      const flow = makeFlow({ tool, accessors, elicitation: { clientCapabilities: URL_ELICITATION, elicit } });

      await expect(flow.checkToolCredentials()).resolves.toBeUndefined();
      expect(elicit).toHaveBeenCalledWith(
        'Connect github to continue: tool "cloud:deploy" needs it.',
        expect.anything(),
        expect.objectContaining({ mode: 'url', url: CONNECT_URL, elicitationId: expect.any(String) }),
      );
    });

    it('answers -32001 when the credential is still missing after the user accepted', async () => {
      const elicit = jest.fn(async () => ({ status: 'accept' }));
      const flow = makeFlow({
        tool,
        accessors: withCredentials({}),
        elicitation: { clientCapabilities: URL_ELICITATION, elicit },
      });

      const error = await gateErrorOf(flow);
      expect(elicit).toHaveBeenCalledTimes(1);
      expect(error.toJsonRpcError().data.authUrl).toBe(CONNECT_URL);
    });

    it.each([['decline'], ['cancel']])('answers -32001 when the user answers %s', async (status) => {
      const { accessors } = credentialsConnectedOnAccept();
      const elicit = jest.fn(async () => ({ status }));
      const flow = makeFlow({ tool, accessors, elicitation: { clientCapabilities: URL_ELICITATION, elicit } });

      await gateErrorOf(flow);
      expect(elicit).toHaveBeenCalledTimes(1);
    });

    it('answers -32001 when asking fails', async () => {
      const elicit = jest.fn(async () => {
        throw new Error('the session closed');
      });
      const flow = makeFlow({
        tool,
        accessors: withCredentials({}),
        elicitation: { clientCapabilities: URL_ELICITATION, elicit },
      });

      await gateErrorOf(flow);
    });

    it('is not asked when the caller has to sign in first', async () => {
      const elicit = jest.fn();
      const anonymousCredentials = {
        requireConnect: jest.fn(async () => ({ connected: false, resumeUrl: '', signInRequired: true })),
      };
      const flow = makeFlow({
        tool,
        accessors: new Map<Token, unknown>([[CREDENTIALS_ACCESSOR, anonymousCredentials]]),
        elicitation: { clientCapabilities: URL_ELICITATION, elicit },
      });

      expect((await gateErrorOf(flow)).signInRequired).toBe(true);
      expect(elicit).not.toHaveBeenCalled();
    });
  });

  it('does not ask a client that declared only form elicitation', async () => {
    const { accessors, elicit } = credentialsConnectedOnAccept();
    const flow = makeFlow({
      tool: { ...TOOL_BASE, metadata: { name: 'deploy', authProviders: ['github'] } },
      accessors,
      elicitation: { clientCapabilities: { elicitation: { form: {} } }, elicit },
    });

    await gateErrorOf(flow);
    expect(elicit).not.toHaveBeenCalled();
  });
});
