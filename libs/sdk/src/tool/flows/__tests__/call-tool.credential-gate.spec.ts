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
 *  - trusted internal dispatch (`internalCall: true`) bypasses the gate.
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
  return flow;
}

/** Fake `this.authProviders` accessor: `get(name)` resolves to a truthy cred or null. */
function authProvidersWith(available: Record<string, boolean>) {
  return {
    get: jest.fn(async (name: string) => (available[name] ? { credential: { type: 'bearer' } } : null)),
  };
}

/** Fake `this.credentials` accessor backed by requireConnect. */
function credentialsWith(connected: Record<string, boolean>, resumeUrl = 'https://server/oauth/connect?token=tok') {
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
});
