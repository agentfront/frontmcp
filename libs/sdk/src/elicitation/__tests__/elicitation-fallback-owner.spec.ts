import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { type DirectAuthContext, type DirectMcpServer } from '../../direct';
import { ElicitationNotOwnedError, ElicitationNotSupportedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { STATELESS_SESSION_ID } from '../../transport/transport.types';
import { resolveElicitationOwner } from '../helpers/fallback.helper';

/**
 * A pending elicitation (the `sendElicitationResult` fallback for clients without native
 * elicitation) belongs to the caller whose tool call raised it.
 *
 * It used to be stored under `authInfo.sessionId ?? 'anonymous'` and resolved by `elicitId` alone,
 * so every stateless caller shared one bucket and any caller holding the id could answer it: the
 * original tool then ran with the victim's input and the answer the intruder chose.
 */

const transfers: string[] = [];

@Tool({ name: 'transfer_funds', inputSchema: { amount: z.number() } })
class TransferFundsTool extends ToolContext {
  async execute(input: { amount: number }) {
    const answer = await this.elicit('Confirm the transfer?', z.object({ confirm: z.boolean() }));
    if (answer.status !== 'accept' || answer.content?.confirm !== true) {
      return { transferred: false };
    }
    transfers.push(`${this.getAuthInfo().clientId}:${input.amount}`);
    return { transferred: true };
  }
}

@App({ id: 'bank', name: 'Bank', tools: [TransferFundsTool] })
class BankApp {}

interface ToolResultShape {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: { elicitationPending?: { elicitId: string } };
}

async function callTool(
  server: DirectMcpServer,
  name: string,
  args: Record<string, unknown>,
  authContext: DirectAuthContext,
): Promise<ToolResultShape | Error> {
  try {
    return (await server.callTool(name, args, { authContext })) as ToolResultShape;
  } catch (error) {
    return error as Error;
  }
}

async function requestTransfer(server: DirectMcpServer, caller: DirectAuthContext): Promise<string> {
  const result = await callTool(server, 'transfer_funds', { amount: 100 }, caller);
  const elicitId = result instanceof Error ? undefined : result._meta?.elicitationPending?.elicitId;
  if (!elicitId) {
    throw new Error(`transfer_funds did not ask for confirmation: ${JSON.stringify(result)}`);
  }
  return elicitId;
}

function confirm(server: DirectMcpServer, elicitId: string, caller: DirectAuthContext) {
  return callTool(server, 'sendElicitationResult', { elicitId, action: 'accept', content: { confirm: true } }, caller);
}

const callers: Array<[string, Record<'alice' | 'mallory', DirectAuthContext>]> = [
  [
    'stateless callers',
    {
      alice: { sessionId: STATELESS_SESSION_ID, user: { sub: 'alice' } },
      mallory: { sessionId: STATELESS_SESSION_ID, user: { sub: 'mallory' } },
    },
  ],
  [
    'callers with their own session',
    {
      alice: { sessionId: 'session-alice', user: { sub: 'alice' } },
      mallory: { sessionId: 'session-mallory', user: { sub: 'mallory' } },
    },
  ],
];

describe.each(callers)('the elicitation fallback for %s', (_, { alice, mallory }) => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    transfers.length = 0;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'elicitation-fallback-owner', version: '1.0.0' },
      apps: [BankApp],
      elicitation: { enabled: true },
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('refuses a result from a caller other than the one it was asked of', async () => {
    const elicitId = await requestTransfer(server, alice);

    const intruder = await confirm(server, elicitId, mallory);

    expect({ transfers, intruder: intruder instanceof Error ? intruder.constructor.name : intruder }).toEqual({
      transfers: [],
      intruder: 'ElicitationNotOwnedError',
    });
    expect(intruder).toBeInstanceOf(ElicitationNotOwnedError);
  });

  it('still takes the result from the caller it was asked of, after a refused attempt', async () => {
    const elicitId = await requestTransfer(server, alice);
    await confirm(server, elicitId, mallory);

    const owner = await confirm(server, elicitId, alice);

    expect(owner).toMatchObject({ structuredContent: { transferred: true } });
    expect(transfers).toEqual(['alice:100']);
  });
});

describe('the elicitation fallback for an anonymous caller without a verified session', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    transfers.length = 0;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'elicitation-fallback-anonymous', version: '1.0.0' },
      apps: [BankApp],
      elicitation: { enabled: true },
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('is refused up front, since no later request could be matched to the caller', async () => {
    const anonymous: DirectAuthContext = { sessionId: STATELESS_SESSION_ID, user: { sub: 'anon:request-1' } };

    const result = await callTool(server, 'transfer_funds', { amount: 100 }, anonymous);

    expect(result).toBeInstanceOf(ElicitationNotSupportedError);
    expect(transfers).toEqual([]);
  });
});

describe('resolveElicitationOwner', () => {
  it('is the session the transport verified', () => {
    expect(resolveElicitationOwner({ authInfo: { sessionId: 'session-1', clientId: 'alice' } })).toBe(
      'session:session-1',
    );
  });

  it('is the session session verification recorded, even when the request carried it outside mcp-session-id', () => {
    expect(resolveElicitationOwner({ authInfo: { clientId: 'alice', extra: { sessionId: 'sse-session' } } })).toBe(
      'session:sse-session',
    );
  });

  it('is the principal when the only session id is the shared stateless one', () => {
    expect(resolveElicitationOwner({ authInfo: { sessionId: STATELESS_SESSION_ID, clientId: 'alice' } })).toBe(
      'principal:alice',
    );
  });

  it('is undefined for an anonymous caller without a verified session', () => {
    expect([
      resolveElicitationOwner(undefined),
      resolveElicitationOwner({ authInfo: {} }),
      resolveElicitationOwner({ authInfo: { sessionId: STATELESS_SESSION_ID, clientId: '' } }),
      resolveElicitationOwner({ authInfo: { sessionId: STATELESS_SESSION_ID, clientId: 'anon:request-1' } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
