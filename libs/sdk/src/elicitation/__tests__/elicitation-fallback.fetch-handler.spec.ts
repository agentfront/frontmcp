/**
 * An anonymous legacy-protocol caller through `createFetchHandler()` that a tool asks for input.
 *
 * Such a caller has no verified session and no identity, so nothing could later tell who may answer
 * a fallback elicitation. It is meant to be refused up front with `ElicitationNotSupportedError`
 * (#624 G365), as through `createDirect()`. Through the fetch handler it got `-32021` (a missing
 * client capability, the MCP 2026-07-28 answer) instead.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';

const transfers: number[] = [];

@Tool({ name: 'transfer_funds', inputSchema: { amount: z.number() } })
class TransferFundsTool extends ToolContext {
  async execute(input: { amount: number }) {
    const answer = await this.elicit('Confirm the transfer?', z.object({ confirm: z.boolean() }));
    if (answer.status !== 'accept' || answer.content?.confirm !== true) return { transferred: false };
    transfers.push(input.amount);
    return { transferred: true };
  }
}

@App({ id: 'bank', name: 'Bank', tools: [TransferFundsTool] })
class BankApp {}

interface JsonRpcMessage {
  result?: { isError?: boolean; content?: Array<{ text?: string }>; _meta?: Record<string, unknown> };
  error?: { code: number; message: string };
}

async function legacyToolCall(server: TestFetchServer, protocolVersion?: string): Promise<JsonRpcMessage> {
  const response = await server.handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'transfer_funds', arguments: { amount: 100 } },
      }),
    }),
  );
  const text = await response.text();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  return JSON.parse(data ?? text) as JsonRpcMessage;
}

describe('fallback elicitation for an anonymous caller through createFetchHandler()', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'fetch-elicitation', version: '1.0.0' },
      apps: [BankApp],
      elicitation: { enabled: true },
    });
  });

  // A 2025-03-26 client sends no MCP-Protocol-Version header at all, and the fetch handler serves
  // such an unversioned call as 2026-07-28 (the Worker default). The client never declared that
  // revision, so it gets the legacy refusal, not a 2026-only `-32021`.
  it.each([
    ['protocol 2025-06-18', '2025-06-18'],
    ['protocol 2025-11-25', '2025-11-25'],
    ['a legacy client that sends no MCP-Protocol-Version header', undefined],
  ])('refuses up front with ElicitationNotSupportedError for %s', async (_label, protocolVersion) => {
    const message = await legacyToolCall(server, protocolVersion);
    const serialized = JSON.stringify(message);

    expect(message.error?.code).not.toBe(-32021);
    expect(serialized).not.toMatch(/MISSING_REQUIRED_CLIENT_CAPABILITY/);
    expect(serialized).toMatch(/does not support elicitation/i);
    expect(transfers).toEqual([]);
  });

  it('still answers a client that declared MCP 2026-07-28 with the missing-capability error', async () => {
    const response = await rpc20260728(server.handler, 'tools/call', {
      name: 'transfer_funds',
      arguments: { amount: 100 },
    });

    expect(response.message.error?.code).toBe(-32021);
    expect(transfers).toEqual([]);
  });
});
