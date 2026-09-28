import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Provider, ProviderScope, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { resolveElicitationOwner } from '../../elicitation/helpers/fallback.helper';
import { type Scope } from '../../scope/scope.instance';

/**
 * A session id the server makes up for one request is not a session.
 *
 * In the anonymous and static auth modes, session verification mints a new session for every request
 * that brings none. A session transport hands that id to the client (`initialize`, the SSE stream)
 * and it names the session from then on. Under MCP 2026-07-28, and on the stateless web transport,
 * nothing does: the next request gets another one. Recorded as the request's verified session, it
 * keyed cross-request state (Remember, feature-flag targeting, elicitation ownership, the CONTEXT
 * provider cache) by a value that lives one request.
 */

let nextScratchpadId = 0;
@Provider({ name: 'CallerScratchpad', scope: ProviderScope.CONTEXT })
class CallerScratchpad {
  readonly id = ++nextScratchpadId;
}

@Tool({ name: 'identity', inputSchema: {} })
class IdentityTool extends ToolContext {
  async execute() {
    const context = this.context;
    return {
      transportSessionId: this.authInfo.sessionId ?? null,
      recordedSessionId: (context.authInfo.extra?.['sessionId'] as string | undefined) ?? null,
      verifiedSessionId: context.verifiedSessionId ?? null,
      owner: resolveElicitationOwner(context) ?? null,
      scratchpad: this.get(CallerScratchpad).id,
    };
  }
}

@App({ id: 'who', name: 'Who', tools: [IdentityTool], providers: [CallerScratchpad] })
class WhoApp {}

interface Identity {
  transportSessionId: string | null;
  recordedSessionId: string | null;
  verifiedSessionId: string | null;
  owner: string | null;
  scratchpad: number;
}

const STATIC_KEY = 'sk-who-static-key-0001';

function server(auth?: FrontMcpConfigInput['auth']): Promise<TestFetchServer> {
  return createTestFetchServer({
    info: { name: 'per-request-session', version: '1.0.0' },
    apps: [WhoApp],
    ...(auth ? { auth } : {}),
  });
}

async function identity2026(target: TestFetchServer, headers: Record<string, string> = {}): Promise<Identity> {
  const { message } = await rpc20260728(target.handler, 'tools/call', { name: 'identity', arguments: {} }, { headers });
  const result = message.result?.['structuredContent'] as Identity | undefined;
  if (!result) throw new Error(`identity failed: ${JSON.stringify(message)}`);
  return result;
}

/** The same call from a client that speaks an earlier revision, on the stateless web transport. */
async function identityLegacy(target: TestFetchServer, headers: Record<string, string> = {}): Promise<Identity> {
  const response = await target.handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'identity', arguments: {} },
      }),
    }),
  );
  const text = await response.text();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  const message = JSON.parse(data ?? text) as { result?: { structuredContent?: Identity } };
  const result = message.result?.structuredContent;
  if (!result) throw new Error(`identity failed: ${text}`);
  return result;
}

function sessionCacheSize(target: TestFetchServer): number {
  const scope = target.instance.getScopes()[0] as Scope;
  const tool = scope.tools.getTools(true).find((entry) => entry.name === 'identity');
  if (!tool) throw new Error('identity tool not found');
  return tool.providers.getSessionCacheStats().size;
}

describe('a per-request session minted for a static-key caller under MCP 2026-07-28', () => {
  let target: TestFetchServer;
  const key = { authorization: `Bearer ${STATIC_KEY}` };

  beforeAll(async () => {
    target = await server({ mode: 'static', tokens: [STATIC_KEY] });
  });

  it('is not recorded as the request’s verified session', async () => {
    const result = await identity2026(target, key);

    expect(result).toMatchObject({ recordedSessionId: null, verifiedSessionId: null });
  });

  it('leaves the caller identified by its key, the same on every request', async () => {
    const [first, second] = [await identity2026(target, key), await identity2026(target, key)];

    expect(first.owner).toMatch(/^principal:static:/);
    expect(second.owner).toBe(first.owner);
  });

  it('adds no entry to the CONTEXT provider session cache', async () => {
    const before = sessionCacheSize(target);
    const scratchpads = [await identity2026(target, key), await identity2026(target, key)].map((r) => r.scratchpad);

    expect(sessionCacheSize(target)).toBe(before);
    expect(scratchpads[0]).not.toBe(scratchpads[1]);
  });

  it('does not become a session when the client sends it back as mcp-session-id', async () => {
    const minted = (await identity2026(target, key)).transportSessionId;
    if (!minted) throw new Error('the 2026-07-28 request carried no per-request id');

    const echoed = await identity2026(target, { ...key, 'mcp-session-id': minted });

    expect(echoed).toMatchObject({ recordedSessionId: null, verifiedSessionId: null });
    expect(echoed.owner).toMatch(/^principal:static:/);
  });
});

describe('a per-request session minted for an anonymous caller under MCP 2026-07-28', () => {
  it('leaves the caller without an owner that a later request could match', async () => {
    const target = await server();

    const result = await identity2026(target);

    expect(result).toMatchObject({ recordedSessionId: null, verifiedSessionId: null, owner: null });
  });
});

describe('a per-request session minted on the stateless web transport', () => {
  it('is not recorded as the verified session of a static-key caller', async () => {
    const target = await server({ mode: 'static', tokens: [STATIC_KEY] });

    const [first, second] = [
      await identityLegacy(target, { authorization: `Bearer ${STATIC_KEY}` }),
      await identityLegacy(target, { authorization: `Bearer ${STATIC_KEY}` }),
    ];

    expect(first).toMatchObject({ recordedSessionId: null, verifiedSessionId: null });
    expect(first.owner).toMatch(/^principal:static:/);
    expect(second.owner).toBe(first.owner);
  });

  it('leaves an anonymous caller without an owner', async () => {
    const target = await server();

    expect(await identityLegacy(target)).toMatchObject({ recordedSessionId: null, owner: null });
  });
});
