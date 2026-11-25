/**
 * `this.idempotencyKey` comes only from an in-process dispatcher that marks its call context with `withIdempotencyKey`:
 * nothing a client sends (arguments, `_meta`, or a plain field on the context) sets it.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { withIdempotencyKey } from '../../tool-idempotency-key';

@Tool({ name: 'read_key', inputSchema: {}, outputSchema: { key: z.string().nullable() } })
class ReadKeyTool extends ToolContext {
  async execute() {
    return { key: this.idempotencyKey ?? null };
  }
}

const dispatchInput = { mark: z.string().optional(), forged: z.string().optional() };

@Tool({ name: 'dispatch', inputSchema: dispatchInput })
class DispatchTool extends ToolContext {
  async execute({ mark, forged }: { mark?: string; forged?: string }) {
    const ctx = { authInfo: this.authInfo, ...(forged !== undefined && { idempotencyKey: forged }) };
    const result = await this.scope.runFlow('tools:call-tool', {
      request: {
        method: 'tools/call',
        params: { name: 'read_key', arguments: {}, ...(forged !== undefined && { _meta: { idempotencyKey: forged } }) },
      },
      ctx: mark === undefined ? ctx : withIdempotencyKey(ctx, mark),
    });
    return result?.structuredContent ?? {};
  }
}

@App({ id: 'keys', name: 'Keys', tools: [ReadKeyTool, DispatchTool] })
class KeysApp {}

describe('this.idempotencyKey', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tool-idempotency-key', version: '1.0.0' },
      apps: [KeysApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('is the key the dispatcher marked the call context with', async () => {
    const result = await server.callTool('dispatch', { mark: 'run-1:0' });

    expect(result.structuredContent).toEqual({ key: 'run-1:0' });
  });

  it('is undefined for a client call, whatever its arguments say', async () => {
    const result = await server.callTool('read_key', { idempotencyKey: 'forged' });

    expect(result.structuredContent).toEqual({ key: null });
  });

  it('is not set by `_meta` or a plain field of the call context', async () => {
    const result = await server.callTool('dispatch', { forged: 'forged' });

    expect(result.structuredContent).toEqual({ key: null });
  });

  it('is the marked key even when the context also has a plain field of that name', async () => {
    const result = await server.callTool('dispatch', { mark: 'run-1:1', forged: 'forged' });

    expect(result.structuredContent).toEqual({ key: 'run-1:1' });
  });

  it('is not copied with the context, which keeps no enumerable trace of it', () => {
    const ctx = withIdempotencyKey({ authInfo: {} }, 'run-1:2');

    expect(Object.keys({ ...ctx })).toEqual(['authInfo']);
    expect(JSON.stringify(ctx)).toBe('{"authInfo":{}}');
  });
});
