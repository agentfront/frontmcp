import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { getRunningTool } from '../../context/running-tool';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type DirectClient } from '../client.types';
import { type DirectMcpServer } from '../direct.types';

/**
 * A browser build resolves `AsyncLocalStorage` to `@frontmcp/utils`' browser implementation
 * (`#async-context` → `browser-async-context.ts`), which has no `node:async_hooks` underneath.
 * These specs run the SDK on that implementation and make two callers overlap: each one's tool
 * awaits while the other's request is in flight. Every caller must still see only its own request
 * context.
 */
jest.mock('#async-context', () => jest.requireActual('../../../../utils/src/async-context/browser-async-context'));

/** One pending release per caller, so the spec decides when each tool resumes. */
const releases = new Map<string, () => void>();

function waitForRelease(caller: string): Promise<void> {
  return new Promise<void>((resolve) => releases.set(caller, resolve));
}

async function release(caller: string): Promise<void> {
  // Let the caller reach its await first; under a one-request-at-a-time runtime it may still be queued.
  for (let i = 0; i < 50 && !releases.has(caller); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  releases.get(caller)?.();
  releases.delete(caller);
}

@Tool({ name: 'whose_request', inputSchema: { caller: z.string() } })
class WhoseRequestTool extends ToolContext {
  async execute({ caller }: { caller: string }) {
    const before = this.context.sessionId;
    await waitForRelease(caller);
    return { before, after: this.context.sessionId, user: this.context.authInfo.user?.sub ?? null };
  }
}

/** Reports the tool it runs as, after waiting `ms`. */
@Tool({ name: 'running_as', inputSchema: { ms: z.number() } })
class RunningAsTool extends ToolContext {
  async execute({ ms }: { ms: number }) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { runningAs: getRunningTool()?.name ?? null };
  }
}

/** Calls `running_as` twice at once, through the flow, the way CodeCall runs a script's calls. */
@Tool({ name: 'fan_out', inputSchema: {} })
class FanOutTool extends ToolContext {
  async execute() {
    const call = (ms: number) =>
      this.scope.runFlow('tools:call-tool', {
        request: { method: 'tools/call', params: { name: 'running_as', arguments: { ms } } },
        ctx: { authInfo: this.authInfo },
      } as never);
    const outcomes = await Promise.allSettled([call(20), call(40)]);
    return {
      outcomes: outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? { ok: !(outcome.value as { isError?: boolean } | undefined)?.isError, value: outcome.value }
          : { ok: false, error: String((outcome.reason as Error)?.name ?? outcome.reason) },
      ),
    };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoseRequestTool, RunningAsTool, FanOutTool] })
class DeskApp {}

interface WhoseRequest {
  before: string;
  after: string;
  user: string | null;
}

function resultOf(response: unknown): WhoseRequest {
  const structured = (response as { structuredContent?: unknown }).structuredContent;
  if (structured) return structured as WhoseRequest;
  const text = (response as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
  return JSON.parse(text) as WhoseRequest;
}

describe('request context on the browser async-context runtime', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'browser-context', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  afterEach(() => {
    for (const resolve of releases.values()) resolve();
    releases.clear();
  });

  it('keeps each overlapping DirectMcpServer call in its own request context', async () => {
    const alice = server.callTool(
      'whose_request',
      { caller: 'session-alice' },
      { authContext: { sessionId: 'session-alice', user: { sub: 'alice' } } },
    );
    const bob = server.callTool(
      'whose_request',
      { caller: 'session-bob' },
      { authContext: { sessionId: 'session-bob', user: { sub: 'bob' } } },
    );

    await release('session-alice');
    const aliceResult = resultOf(await alice);
    await release('session-bob');
    const bobResult = resultOf(await bob);

    expect(aliceResult).toEqual({ before: 'session-alice', after: 'session-alice', user: 'alice' });
    expect(bobResult).toEqual({ before: 'session-bob', after: 'session-bob', user: 'bob' });
  });

  it('keeps each overlapping connect() client in its own request context', async () => {
    const aliceClient: DirectClient = await server.connect({ session: { id: 'client-alice', user: { sub: 'alice' } } });
    const bobClient: DirectClient = await server.connect({ session: { id: 'client-bob', user: { sub: 'bob' } } });
    try {
      const alice = aliceClient.callTool('whose_request', { caller: 'client-alice' });
      const bob = bobClient.callTool('whose_request', { caller: 'client-bob' });

      await release('client-alice');
      const aliceResult = resultOf(await alice);
      await release('client-bob');
      const bobResult = resultOf(await bob);

      expect(aliceResult).toEqual({ before: 'client-alice', after: 'client-alice', user: 'alice' });
      expect(bobResult).toEqual({ before: 'client-bob', after: 'client-bob', user: 'bob' });
    } finally {
      await aliceClient.close();
      await bobClient.close();
    }
  });

  it('refuses concurrent calls inside one request instead of letting them read each other', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await server.callTool('fan_out', {});
      const outcomes = (resultOf(response) as unknown as { outcomes: Array<{ ok: boolean; value?: unknown }> })
        .outcomes;

      // Without AsyncContext the two calls cannot be told apart once they overlap, so both are
      // refused rather than one of them returning the other's context.
      expect(outcomes).toEqual([
        { ok: false, error: 'ToolExecutionError' },
        { ok: false, error: 'ToolExecutionError' },
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('serves the next request normally after an overlap was refused', async () => {
    const response = server.callTool(
      'whose_request',
      { caller: 'after-overlap' },
      { authContext: { sessionId: 'after-overlap', user: { sub: 'carol' } } },
    );
    await release('after-overlap');
    expect(resultOf(await response)).toEqual({
      before: 'after-overlap',
      after: 'after-overlap',
      user: 'carol',
    });
  });
});
