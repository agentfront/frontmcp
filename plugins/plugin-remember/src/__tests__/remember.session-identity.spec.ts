/**
 * `session` and `tool` memory belong to the session the server verified, never to an
 * `mcp-session-id` a client merely sends.
 *
 * Under MCP 2026-07-28 a request may carry an `mcp-session-id` the server never issued or
 * verified, and `FrontMcpContext.sessionId` takes it as-is. Keyed on it, any caller could read or
 * overwrite another caller's memory by sending that caller's session id.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { z } from '@frontmcp/lazy-zod';
import { App, connect, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectClient } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

const scopeSchema = z.enum(['session', 'tool']);

/** Stores `card` when given, and answers the card remembered in `scope`. One tool, so `tool` scope is shared. */
@Tool({ name: 'card', inputSchema: { card: z.string().optional(), scope: scopeSchema } })
class CardTool extends ToolContext {
  async execute(input: { card?: string; scope: 'session' | 'tool' }) {
    const remember = this.get(RememberAccessorToken);
    if (input.card !== undefined) await remember.set('card', input.card, { scope: input.scope });
    return { card: (await remember.get<string>('card', { scope: input.scope })) ?? null };
  }
}

@App({
  id: 'wallet',
  name: 'Wallet',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [CardTool],
})
class WalletApp {}

describe('Remember session identity over MCP 2026-07-28', () => {
  const issuer = 'https://auth.example.com';
  let signToken: (subject: string) => Promise<string>;
  let handler: (request: Request) => Promise<Response>;
  let requestId = 1;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'remember-spec', alg: 'RS256', use: 'sig' };
    signToken = (subject) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'remember-spec' })
        .setIssuer(issuer)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'remember-session-identity', version: '1.0.0' },
      apps: [WalletApp],
      auth: { mode: 'transparent', provider: issuer, providerConfig: { jwks: { keys: [jwk] } } },
      logging: { level: LogLevel.Off },
    });
  });

  async function callTool(
    subject: string,
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const response = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${await signToken(subject)}`,
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId++,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'remember-spec', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    );
    const message = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
    if (message.error || message.result?.['isError']) {
      throw new Error(`${name} failed: ${JSON.stringify(message)}`);
    }
    return message.result?.['structuredContent'] as Record<string, unknown>;
  }

  it.each(['session', 'tool'] as const)(
    'does not let a caller read %s memory by sending another caller’s mcp-session-id',
    async (scope) => {
      const victimSession = `victim-session-${scope}`;
      await callTool('alice', 'card', { card: '4242', scope }, victimSession);

      const stolen = await callTool('mallory', 'card', { scope }, victimSession);

      expect(stolen).toEqual({ card: null });
    },
  );

  it.each(['session', 'tool'] as const)(
    'does not let a caller overwrite %s memory by sending another caller’s mcp-session-id',
    async (scope) => {
      const victimSession = `overwritten-session-${scope}`;
      await callTool('alice', 'card', { card: '4242', scope }, victimSession);

      await callTool('mallory', 'card', { card: '0000', scope }, victimSession);

      expect(await callTool('alice', 'card', { scope }, victimSession)).toEqual({ card: '4242' });
    },
  );

  it('keeps an authenticated caller’s session memory across requests without a session', async () => {
    await callTool('carol', 'card', { card: '1111', scope: 'session' });

    expect(await callTool('carol', 'card', { scope: 'session' })).toEqual({ card: '1111' });
    expect(await callTool('dave', 'card', { scope: 'session' })).toEqual({ card: null });
  });
});

describe('Remember session identity for clients with a verified session', () => {
  let alice: DirectClient;
  let bob: DirectClient;

  beforeAll(async () => {
    const config = {
      info: { name: 'remember-verified-sessions', version: '1.0.0' },
      apps: [WalletApp],
      logging: { level: LogLevel.Off },
    };
    alice = await connect(config);
    bob = await connect(config);
  });

  afterAll(async () => {
    await Promise.all([alice.close(), bob.close()]);
  });

  it('keeps session memory within the session and apart from other sessions', async () => {
    await alice.callTool('card', { card: '4242', scope: 'session' });

    const [own, other] = await Promise.all([
      alice.callTool('card', { scope: 'session' }),
      bob.callTool('card', { scope: 'session' }),
    ]);

    expect([JSON.stringify(own), JSON.stringify(other)]).toEqual([
      expect.stringContaining('\\"card\\":\\"4242\\"'),
      expect.stringContaining('\\"card\\":null'),
    ]);
  });
});
