import 'reflect-metadata';

import type { PartitionKey } from '@frontmcp/guard';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type Rpc20260728Response,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';

const LIMITED_AFTER_TWO = ['ok', 'ok', 'RATE_LIMIT_EXCEEDED', 'RATE_LIMIT_EXCEEDED', 'RATE_LIMIT_EXCEEDED'];

let partitionServerCount = 0;

function outcomeOf({ message }: Rpc20260728Response): string {
  if (message.error) return `jsonrpc ${message.error.code}`;
  const result = message.result as { isError?: boolean; _meta?: { code?: string } };
  return result.isError ? String(result._meta?.code) : 'ok';
}

async function callFiveTimes(
  partitionBy: PartitionKey,
  options: { auth?: FrontMcpConfigInput['auth']; headers?: Record<string, string> } = {},
): Promise<string[]> {
  partitionServerCount += 1;
  const toolName = `search_${partitionServerCount}`;

  @Tool({ name: toolName, inputSchema: {}, rateLimit: { maxRequests: 2, windowMs: 60_000, partitionBy } })
  class SearchTool extends ToolContext {
    async execute() {
      return { ok: true };
    }
  }

  @App({ id: `docs-${partitionServerCount}`, name: `docs-${partitionServerCount}`, tools: [SearchTool] })
  class DocsApp {}

  const { handler } = await createTestFetchServer({
    info: { name: `rate-limit-partitions-${partitionServerCount}`, version: '1.0.0' },
    apps: [DocsApp],
    throttle: { enabled: true },
    ...(options.auth ? { auth: options.auth } : {}),
  });

  const outcomes: string[] = [];
  for (let index = 0; index < 5; index++) {
    const response = await rpc20260728(
      handler,
      'tools/call',
      { name: toolName, arguments: {} },
      { headers: options.headers },
    );
    outcomes.push(outcomeOf(response));
  }
  return outcomes;
}

describe('call-tool rate-limit partitions (2026-07-28, maxRequests 2, five calls from one client)', () => {
  it('limits a global partition after two calls', async () => {
    expect(await callFiveTimes('global')).toEqual(LIMITED_AFTER_TWO);
  });

  it('limits a session partition for an anonymous caller after two calls', async () => {
    expect(await callFiveTimes('session')).toEqual(LIMITED_AFTER_TWO);
  });

  it('limits a session partition for a signed-in caller that sends the same token after two calls', async () => {
    const issuer = await createTestJwtIssuer();
    const token = await issuer.sign({}, 'user-1');

    const outcomes = await callFiveTimes('session', {
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      headers: { authorization: `Bearer ${token}` },
    });

    expect(outcomes).toEqual(LIMITED_AFTER_TWO);
  });

  it('limits a userId partition for an anonymous caller after two calls', async () => {
    expect(await callFiveTimes('userId')).toEqual(LIMITED_AFTER_TWO);
  });

  describe('behind a trusted proxy', () => {
    const originalTrustProxy = process.env['FRONTMCP_TRUST_PROXY'];

    beforeAll(() => {
      process.env['FRONTMCP_TRUST_PROXY'] = 'true';
    });

    afterAll(() => {
      if (originalTrustProxy === undefined) delete process.env['FRONTMCP_TRUST_PROXY'];
      else process.env['FRONTMCP_TRUST_PROXY'] = originalTrustProxy;
    });

    it('limits an ip partition for one x-forwarded-for client after two calls', async () => {
      const outcomes = await callFiveTimes('ip', { headers: { 'x-forwarded-for': '203.0.113.9' } });

      expect(outcomes).toEqual(LIMITED_AFTER_TWO);
    });
  });
});
