import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';
import { resolveElicitationOwner } from '../../elicitation/helpers/fallback.helper';

/**
 * The stateless web-standard transport (Workers, `createFetchHandler`) gives each request's fresh
 * MCP server a `web:<uuid>` id, which reaches the handlers' `authInfo.sessionId`. It identifies one
 * request, not a caller, so it must never stand in for a verified session: the request context
 * (which Remember and elicitation ownership read) carries in `extra.sessionId` only a session the
 * request presented and `session:verify` accepted. Neither is the session `session:verify` mints
 * for an anonymous request that presents none.
 */

@Tool({ name: 'identity', inputSchema: {} })
class IdentityTool extends ToolContext {
  async execute() {
    const context = this.tryGetContext();
    return {
      transportSessionId: this.authInfo?.sessionId ?? null,
      contextSessionId: context?.authInfo?.sessionId ?? null,
      verifiedSessionId: (context?.authInfo?.extra as Record<string, unknown> | undefined)?.['sessionId'] ?? null,
      owner: resolveElicitationOwner(context) ?? null,
    };
  }
}

@App({ id: 'who', name: 'Who', tools: [IdentityTool] })
class WhoApp {}

interface IdentityResult {
  transportSessionId: string | null;
  contextSessionId: string | null;
  verifiedSessionId: string | null;
  owner: string | null;
}

describe('stateless web transport session identity', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'web-identity', version: '1.0.0' }, apps: [WhoApp] });
  });

  async function callIdentity(): Promise<IdentityResult> {
    const response = await server.handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
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
    const message = JSON.parse(data ?? text) as { result?: { structuredContent?: IdentityResult } };
    const result = message.result?.structuredContent;
    if (!result) throw new Error(`identity tool returned no result: ${text}`);
    return result;
  }

  it('keeps the per-request web: id out of the request context and the elicitation owner', async () => {
    const result = await callIdentity();

    expect(result.transportSessionId).toMatch(/^web:/);
    expect(result).toMatchObject({ contextSessionId: null, verifiedSessionId: null, owner: null });
  });

  it('gives each request a fresh web: id without changing who the caller is', async () => {
    const first = await callIdentity();
    const second = await callIdentity();

    expect(first.transportSessionId).not.toBe(second.transportSessionId);
    expect([first.owner, second.owner]).toEqual([null, null]);
  });
});
