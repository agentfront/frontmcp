/**
 * call-tool flow — runtime consent enforcement (checkToolAuthorization stage).
 *
 * The verified token's `consent` claim gates which tools may be invoked:
 * - a tool NOT in the consented set is rejected with ToolNotConsentedError,
 * - a tool IN the consented set is allowed,
 * - a token with NO consent metadata allows everything (default preserved),
 * - trusted internal dispatch (`internalCall: true`) bypasses consent.
 */
import 'reflect-metadata';

import { createMockScopeEntry } from '../../../__test-utils__';
import { FlowControl } from '../../../common';
import { ToolNotConsentedError } from '../../../errors';
import CallToolFlow from '../call-tool.flow';

const inputSchema = { parse: (v: unknown) => v } as any;
const outputSchema = { parse: (v: unknown) => v } as any;

function makeFlow(opts: {
  tool: { name: string; fullName: string; owner?: { id: string } };
  authInfo?: Record<string, unknown>;
  ctx?: Record<string, unknown>;
}): CallToolFlow {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
  // Provide a minimal metadata object; only inputSchema/outputSchema parsing is
  // used by the constructor, and we invoke checkToolAuthorization directly.
  const metadata = {
    name: 'tools:call-tool',
    plan: { pre: ['checkToolAuthorization'], execute: [], finalize: [] },
    inputSchema,
    outputSchema,
    access: 'authorized',
  } as any;
  const rawInput = { request: { method: 'tools/call', params: {} }, ctx: opts.ctx ?? {} };
  const flow = new CallToolFlow(metadata, rawInput, scope, jest.fn(), new Map());
  // Seed the stage's inputs directly.
  flow.state.set('tool', opts.tool as any);
  if (opts.authInfo) flow.state.set('authInfo', opts.authInfo as any);
  return flow;
}

const TOOL = { name: 'notes:create', fullName: 'notes:notes:create', owner: { id: 'notes' } };

describe('call-tool consent enforcement', () => {
  it('rejects a tool that is not in the consented set', async () => {
    const flow = makeFlow({
      tool: TOOL,
      authInfo: { extra: { user: { consent: { enabled: true, selectedTools: ['notes:list'] } } } },
    });

    await expect(flow.checkToolAuthorization()).rejects.toBeInstanceOf(ToolNotConsentedError);
  });

  it('allows a tool that IS in the consented set', async () => {
    const flow = makeFlow({
      tool: TOOL,
      authInfo: { extra: { user: { consent: { enabled: true, selectedTools: ['notes:create'] } } } },
    });

    // No throw → consent passed (the app-level check below is a no-op without
    // an `extra.authorization` projection).
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('matches the consented set against the bare effective name too (not just fullName)', async () => {
    const flow = makeFlow({
      tool: TOOL,
      // The consent screen offers the effective `name` (notes:create), not the
      // app-prefixed fullName — so a bare-name match must be accepted.
      authInfo: { extra: { user: { consent: { enabled: true, selectedTools: ['notes:create'] } } } },
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('allows any tool when the token carries NO consent metadata (consent disabled — default preserved)', async () => {
    const flow = makeFlow({
      tool: TOOL,
      authInfo: { extra: { user: { sub: 'u1' } } }, // no consent claim
    });
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('rejects ALL tools when consent is enabled with an empty selection', async () => {
    const flow = makeFlow({
      tool: TOOL,
      authInfo: { extra: { user: { consent: { enabled: true, selectedTools: [] } } } },
    });
    await expect(flow.checkToolAuthorization()).rejects.toBeInstanceOf(ToolNotConsentedError);
  });

  it('bypasses consent for trusted internal dispatch (internalCall: true)', async () => {
    const flow = makeFlow({
      tool: TOOL,
      authInfo: { extra: { user: { consent: { enabled: true, selectedTools: ['notes:list'] } } } },
      ctx: { internalCall: true },
    });
    // Internal calls are not subject to the user's consent selection.
    await expect(flow.checkToolAuthorization()).resolves.toBeUndefined();
  });

  it('produces a FORBIDDEN JSON-RPC error for an un-consented tool', () => {
    const err = new ToolNotConsentedError('notes:create');
    const json = err.toJsonRpcError();
    expect(json.code).toBe(-32003); // FORBIDDEN
    expect(json.data.tool).toBe('notes:create');
    expect(json.message).toContain('not consented');
    // Sanity: it is a public error so the message reaches the client.
    expect(err).not.toBeInstanceOf(FlowControl);
  });
});
