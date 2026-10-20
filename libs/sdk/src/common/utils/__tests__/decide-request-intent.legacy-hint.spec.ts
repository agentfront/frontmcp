import { type ServerRequest } from '../../interfaces';
import { decideIntent, type Config } from '../decide-request-intent.utils';

const LEGACY_HINT = 1 << 6;

const cfg: Config = {
  enableLegacySSE: false,
  enableSseListener: true,
  enableStreamableHttp: true,
  enableStatelessHttp: false,
  enableStatefulHttp: false,
  requireSessionForStreamable: true,
  tolerateMissingAccept: true,
};

function request(sessionId: string): ServerRequest {
  return {
    method: 'POST',
    path: '/mcp',
    url: '/mcp',
    headers: { accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call' },
  } as unknown as ServerRequest;
}

const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

function legacyHint(sessionId: string): boolean {
  return ((decideIntent(request(sessionId), cfg).debug?.flags ?? 0) & LEGACY_HINT) !== 0;
}

describe('decideIntent legacy SSE hint from the session id', () => {
  it('reads transportType from a base64 JSON session id', () => {
    expect(legacyHint(base64url(JSON.stringify({ transportType: 'legacy-sse' })))).toBe(true);
  });

  it('reads it after leading JSON whitespace', () => {
    expect(legacyHint(base64url(` \n\t{"transportType":"legacy-sse"}`))).toBe(true);
  });

  it('ignores another transportType', () => {
    expect(legacyHint(base64url(JSON.stringify({ transportType: 'streamable-http' })))).toBe(false);
  });

  it.each([
    ['an encrypted session id', 'iv123.tag456.Y2lwaGVydGV4dA'],
    ['a JSON string', base64url('"legacy-sse"')],
    ['a JSON array', base64url('[{"transportType":"legacy-sse"}]')],
    ['malformed JSON', base64url('{"transportType":')],
  ])('sets no hint for %s', (_label, sessionId) => {
    expect(legacyHint(sessionId)).toBe(false);
  });
});
