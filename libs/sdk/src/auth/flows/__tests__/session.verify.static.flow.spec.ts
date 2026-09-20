/**
 * SessionVerifyFlow — issue #544.
 *
 * Two behaviours, both about a bearer token that is not a JWT:
 *
 *  1. `public` mode used to 401 one, because `verifyIfJwt` rejected anything
 *     that did not parse as a JWT without first asking whether the mode had an
 *     issuer to verify against. A request WITH a credential therefore fared
 *     worse than the same request with none.
 *  2. `static` mode is the new first-class shape for a fixed shared secret —
 *     what ChatGPT's "Access token / API key" connector option sends.
 */
import 'reflect-metadata';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpRequestInputSchema, parseAuthOptions, type FlowMetadata } from '../../../common';
import SessionVerifyFlow, { sessionVerifyOutputSchema } from '../session.verify.flow';

const STAGES = ['parseInput', 'handleStaticToken', 'handlePublicMode', 'verifyIfJwt'] as const;

function createMetadata(): FlowMetadata<'session:verify'> {
  return {
    name: 'session:verify',
    plan: { pre: [...STAGES], execute: [] },
    inputSchema: httpRequestInputSchema,
    outputSchema: sessionVerifyOutputSchema,
    access: 'authorized',
  } as unknown as FlowMetadata<'session:verify'>;
}

function run(authOptions: Record<string, unknown>, headers: Record<string, string>) {
  const scope = createMockScopeEntry({ auth: authOptions as never });
  (scope.auth as unknown as Record<string, unknown>)['options'] = parseAuthOptions(authOptions as never);
  const input = createMockHttpRequest({ method: 'POST', path: '/', headers });
  const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), new Map());
  return runFlowStages(flow, [...STAGES]);
}

const TOKEN = 'sk-live-0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'sk-live-ffffffffffffffffffffffffffffffff';

describe('public mode must not punish a credentialed request (#544)', () => {
  it('serves a non-JWT bearer anonymously instead of returning 401', async () => {
    const { output } = await run({ mode: 'public' }, { authorization: `Bearer ${TOKEN}` });

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    expect(output.authorization.user?.sub).toMatch(/^anon:/);
  });

  it('is no less permissive with a credential than without one', async () => {
    const anonymous = await run({ mode: 'public' }, {});
    const credentialed = await run({ mode: 'public' }, { authorization: `Bearer ${TOKEN}` });

    expect(anonymous.output?.kind).toBe('authorized');
    expect(credentialed.output?.kind).toBe(anonymous.output?.kind);
  });

  it('still hands a JWT-shaped token to verification rather than waving it through', async () => {
    // Public mode verifies gateway tokens against its own HS256 secret, so a
    // JWT must NOT short-circuit into an anonymous session — only a token with
    // nothing to verify it against does.
    const scope = createMockScopeEntry({ auth: { mode: 'public' } as never });
    (scope.auth as unknown as Record<string, unknown>)['options'] = parseAuthOptions({ mode: 'public' } as never);
    const input = createMockHttpRequest({
      method: 'POST',
      path: '/',
      headers: { authorization: 'Bearer aaa.bbb.ccc' },
    });
    const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), new Map());

    const { output } = await runFlowStages(flow, ['parseInput', 'handlePublicMode']);

    expect(output).toBeUndefined();
  });
});

describe('static mode (#544)', () => {
  const staticAuth = { mode: 'static', tokens: [TOKEN] };

  it('authorizes a request presenting a configured token', async () => {
    const { output } = await run(staticAuth, { authorization: `Bearer ${TOKEN}` });

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    expect(output.authorization.user?.sub).toMatch(/^static:[0-9a-f]{12}$/);
    expect(output.authorization.user?.scope).toBe('static');
  });

  it('never puts the token in the identity it derives', async () => {
    const { output } = await run(staticAuth, { authorization: `Bearer ${TOKEN}` });

    if (output?.kind !== 'authorized') throw new Error('expected authorized');
    expect(JSON.stringify(output)).not.toContain(TOKEN);
  });

  it('gives each configured token a distinct, stable subject', async () => {
    const twoTokens = { mode: 'static', tokens: [TOKEN, OTHER_TOKEN] };
    const first = await run(twoTokens, { authorization: `Bearer ${TOKEN}` });
    const second = await run(twoTokens, { authorization: `Bearer ${OTHER_TOKEN}` });
    const firstAgain = await run(twoTokens, { authorization: `Bearer ${TOKEN}` });

    if (first.output?.kind !== 'authorized' || second.output?.kind !== 'authorized') {
      throw new Error('expected authorized');
    }
    if (firstAgain.output?.kind !== 'authorized') throw new Error('expected authorized');
    expect(first.output.authorization.user?.sub).not.toBe(second.output.authorization.user?.sub);
    expect(firstAgain.output.authorization.user?.sub).toBe(first.output.authorization.user?.sub);
  });

  it('rejects a wrong token with a Bearer challenge', async () => {
    const { output } = await run(staticAuth, { authorization: 'Bearer not-the-token' });

    expect(output?.kind).toBe('unauthorized');
    if (output?.kind !== 'unauthorized') return;
    expect(output.prmMetadataHeader).toContain('Bearer realm="mcp"');
    expect(output.prmMetadataHeader).toContain('invalid_token');
  });

  it('rejects a missing credential', async () => {
    const { output } = await run(staticAuth, {});

    expect(output?.kind).toBe('unauthorized');
    if (output?.kind !== 'unauthorized') return;
    expect(output.prmMetadataHeader).toContain('Bearer realm="mcp"');
  });

  it('rejects a token sent under the wrong scheme', async () => {
    const { output } = await run(staticAuth, { authorization: `Basic ${TOKEN}` });

    expect(output?.kind).toBe('unauthorized');
  });

  it('accepts the scheme case-insensitively, per RFC 7235', async () => {
    const { output } = await run(staticAuth, { authorization: `bearer ${TOKEN}` });

    expect(output?.kind).toBe('authorized');
  });

  it('never accepts a prefix of a configured token', async () => {
    const { output } = await run(staticAuth, { authorization: `Bearer ${TOKEN.slice(0, -1)}` });

    expect(output?.kind).toBe('unauthorized');
  });

  it('reads a custom header with no scheme prefix', async () => {
    const apiKeyAuth = { mode: 'static', tokens: [TOKEN], header: 'x-api-key', scheme: '' };
    const { output } = await run(apiKeyAuth, { 'x-api-key': TOKEN });

    expect(output?.kind).toBe('authorized');
  });

  it('ignores the authorization header when a different one is configured', async () => {
    const apiKeyAuth = { mode: 'static', tokens: [TOKEN], header: 'x-api-key', scheme: '' };
    const { output } = await run(apiKeyAuth, { authorization: `Bearer ${TOKEN}` });

    expect(output?.kind).toBe('unauthorized');
  });

  it('grants the configured scopes and realm', async () => {
    const scoped = { mode: 'static', tokens: [TOKEN], scopes: ['read', 'write'], realm: 'twilio-mcp' };
    const granted = await run(scoped, { authorization: `Bearer ${TOKEN}` });
    const refused = await run(scoped, {});

    if (granted.output?.kind !== 'authorized') throw new Error('expected authorized');
    expect(granted.output.authorization.user?.scope).toBe('read write');
    if (refused.output?.kind !== 'unauthorized') throw new Error('expected unauthorized');
    expect(refused.output.prmMetadataHeader).toContain('realm="twilio-mcp"');
  });

  it('strips control characters out of the realm rather than emitting them in a header', async () => {
    const injected = { mode: 'static', tokens: [TOKEN], realm: 'evil"\r\nX-Injected: yes' };
    const { output } = await run(injected, {});

    if (output?.kind !== 'unauthorized') throw new Error('expected unauthorized');
    expect(output.prmMetadataHeader).not.toMatch(/[\r\n"]X/);
    expect(output.prmMetadataHeader).not.toContain('\r');
    expect(output.prmMetadataHeader).not.toContain('\n');
    expect(output.prmMetadataHeader).toContain('Bearer realm="evilX-Injected: yes"');
  });

  it('requires a space after the scheme, not merely the prefix', async () => {
    const { output } = await run(staticAuth, { authorization: `Bearer${TOKEN}` });

    expect(output?.kind).toBe('unauthorized');
  });

  it('tolerates extra whitespace between the scheme and the token', async () => {
    const { output } = await run(staticAuth, { authorization: `Bearer   ${TOKEN}  ` });

    expect(output?.kind).toBe('authorized');
  });

  it('rejects an empty credential after the scheme', async () => {
    const { output } = await run(staticAuth, { authorization: 'Bearer   ' });

    expect(output?.kind).toBe('unauthorized');
  });

  it('matches whichever configured token is presented, regardless of position', async () => {
    const many = { mode: 'static', tokens: ['a'.repeat(40), 'b'.repeat(40), TOKEN] };
    const { output } = await run(many, { authorization: `Bearer ${TOKEN}` });

    expect(output?.kind).toBe('authorized');
  });

  it('refuses to resume a session minted for a DIFFERENT configured token', async () => {
    // Two callers, two tokens. Token A's session id must not resolve token B's
    // request onto A's session (and therefore A's live transport).
    const twoTokens = { mode: 'static', tokens: [TOKEN, OTHER_TOKEN] };
    const first = await run(twoTokens, { authorization: `Bearer ${TOKEN}` });
    if (first.output?.kind !== 'authorized') throw new Error('expected authorized');
    const tokenASession = first.output.authorization.session?.id as string;
    expect(tokenASession).toBeTruthy();

    const stolen = await run(twoTokens, {
      authorization: `Bearer ${OTHER_TOKEN}`,
      'mcp-session-id': tokenASession,
    });

    // Token B is valid, so the request is authorized — but on a FRESH session.
    expect(stolen.output?.kind).toBe('authorized');
    if (stolen.output?.kind !== 'authorized') return;
    expect(stolen.output.authorization.session?.id).not.toBe(tokenASession);
    expect(stolen.output.authorization.user?.sub).not.toBe(first.output.authorization.user?.sub);
  });

  it('resumes a session minted for the SAME token', async () => {
    const first = await run(staticAuth, { authorization: `Bearer ${TOKEN}` });
    if (first.output?.kind !== 'authorized') throw new Error('expected authorized');
    const sessionId = first.output.authorization.session?.id as string;

    const second = await run(staticAuth, { authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sessionId });

    if (second.output?.kind !== 'authorized') throw new Error('expected authorized');
    expect(second.output.authorization.session?.id).toBe(sessionId);
  });

  it('advertises the configured scheme in the challenge, not a hardcoded Bearer', async () => {
    const apiKeyScheme = { mode: 'static', tokens: [TOKEN], scheme: 'ApiKey' };
    const { output } = await run(apiKeyScheme, {});

    if (output?.kind !== 'unauthorized') throw new Error('expected unauthorized');
    expect(output.prmMetadataHeader).toContain('ApiKey realm="mcp"');
    expect(output.prmMetadataHeader).not.toContain('Bearer');
  });

  it('sends no challenge for a bare-token header, which has no auth scheme', async () => {
    const apiKeyAuth = { mode: 'static', tokens: [TOKEN], header: 'x-api-key', scheme: '' };
    const { output } = await run(apiKeyAuth, {});

    if (output?.kind !== 'unauthorized') throw new Error('expected unauthorized');
    expect(output.prmMetadataHeader).toBe('');
  });

  it('does not fall through to anonymous access when the token is absent', async () => {
    // The whole point of the mode: unlike `public`, a missing credential is a 401.
    const { output } = await run(staticAuth, {});

    expect(output?.kind).not.toBe('authorized');
  });
});
