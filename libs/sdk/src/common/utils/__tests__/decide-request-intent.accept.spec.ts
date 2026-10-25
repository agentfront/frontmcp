import { type ServerRequest } from '../../interfaces';
import { toLegacyProtocolFlags } from '../../types/options/transport/schema';
import { decideIntent, type Config } from '../decide-request-intent.utils';

const routerConfig: Config = { ...toLegacyProtocolFlags('legacy'), tolerateMissingAccept: true };
const strictAcceptConfig: Config = { ...routerConfig, tolerateMissingAccept: false };
const legacyDisabledConfig: Config = { ...toLegacyProtocolFlags('modern'), tolerateMissingAccept: true };

const toolsList = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '1' } },
};

interface PostOptions {
  path: string;
  query?: string;
  accept?: string;
  sessionId?: string;
  body?: unknown;
}

function post({ path, query = '', accept, sessionId, body = toolsList }: PostOptions): ServerRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accept !== undefined) headers['accept'] = accept;
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
  return { method: 'POST', path, url: `${path}${query}`, headers, body } as unknown as ServerRequest;
}

function legacyMessagePost(accept: string | undefined): ServerRequest {
  return post({ path: '/mcp/message', query: '?sessionId=legacy-session', accept });
}

const ANY_ACCEPT = [
  ['application/json', 'application/json'],
  ['text/event-stream', 'text/event-stream'],
  ['application/json, text/event-stream', 'application/json, text/event-stream'],
  ['*/*', '*/*'],
  ['application/*', 'application/*'],
  ['text/plain', 'text/plain'],
  ['no Accept header', undefined],
] as const;

describe('decideIntent: a legacy SSE message post', () => {
  it.each(ANY_ACCEPT)('routes to legacy SSE with %s', (_label, accept) => {
    expect(decideIntent(legacyMessagePost(accept), routerConfig).intent).toBe('legacy-sse');
  });

  it.each(ANY_ACCEPT)('routes to legacy SSE with %s when a missing Accept is not tolerated', (_label, accept) => {
    expect(decideIntent(legacyMessagePost(accept), strictAcceptConfig).intent).toBe('legacy-sse');
  });

  it('is still refused when legacy SSE is disabled', () => {
    const decision = decideIntent(legacyMessagePost('*/*'), legacyDisabledConfig);

    expect(decision.intent).toBe('unknown');
    expect(decision.recommendation).toEqual({ httpStatus: 405, message: 'Legacy SSE disabled' });
  });

  it('is still unrouted without a session id', () => {
    expect(decideIntent(post({ path: '/mcp/message', accept: '*/*' }), routerConfig).intent).toBe('unknown');
  });
});

describe('decideIntent: a Streamable HTTP post to the entry path keeps its Accept rules', () => {
  it.each([
    ['application/json, text/event-stream', 'streamable-http'],
    ['text/event-stream', 'streamable-http'],
    ['application/json', 'stateful-http'],
  ])('routes initialize with Accept %s to %s', (accept, intent) => {
    expect(decideIntent(post({ path: '/mcp', accept, body: initialize }), routerConfig).intent).toBe(intent);
  });

  it('routes initialize without an Accept header to stateful HTTP when the router tolerates it', () => {
    expect(decideIntent(post({ path: '/mcp', body: initialize }), routerConfig).intent).toBe('stateful-http');
  });

  it('refuses initialize without an Accept header when a missing Accept is not tolerated', () => {
    const decision = decideIntent(post({ path: '/mcp', body: initialize }), strictAcceptConfig);

    expect(decision.intent).toBe('unknown');
    expect(decision.recommendation).toEqual({ httpStatus: 406, message: 'Not acceptable' });
  });

  it.each(['*/*', 'application/*', 'text/plain'])('refuses initialize with Accept %s as not acceptable', (accept) => {
    const decision = decideIntent(post({ path: '/mcp', accept, body: initialize }), routerConfig);

    expect(decision.intent).toBe('unknown');
    expect(decision.recommendation).toEqual({ httpStatus: 406, message: 'Not acceptable' });
  });

  it.each(['*/*', 'application/*'])('refuses a session request with Accept %s as not acceptable', (accept) => {
    const decision = decideIntent(post({ path: '/mcp', accept, sessionId: 'streamable-session' }), routerConfig);

    expect(decision.intent).toBe('unknown');
    expect(decision.recommendation).toEqual({ httpStatus: 406, message: 'Not acceptable' });
  });

  it('routes a session request that lists both media types to Streamable HTTP', () => {
    const request = post({
      path: '/mcp',
      accept: 'application/json, text/event-stream',
      sessionId: 'streamable-session',
    });

    expect(decideIntent(request, routerConfig).intent).toBe('streamable-http');
  });

  it('does not treat a sessionId query on the entry path as a legacy SSE message', () => {
    const request = post({ path: '/mcp', query: '?sessionId=legacy-session', accept: '*/*' });

    expect(decideIntent(request, routerConfig).intent).toBe('unknown');
  });
});
