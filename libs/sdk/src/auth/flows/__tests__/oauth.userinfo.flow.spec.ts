/**
 * OAuth UserInfo Flow — GET /oauth/userinfo
 *
 * The `userinfo_endpoint` advertised by the oauth-authorization-server
 * discovery document must actually serve user claims. This flow verifies the
 * Bearer token's HS256 signature + lifetime via the auth instance's
 * `verifyGatewayToken` and returns `sub` (plus optional email/name/picture).
 * A missing or invalid token returns 401.
 */
import 'reflect-metadata';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpInputSchema, HttpJsonSchema, type FlowMetadata, type ScopeEntry } from '../../../common';
import OauthUserInfoFlow from '../oauth.userinfo.flow';

function createUserInfoMetadata(): FlowMetadata<'oauth:userinfo'> {
  return {
    name: 'oauth:userinfo',
    plan: {
      pre: ['parseInput'],
      execute: ['verifyAndRespond'],
    },
    inputSchema: httpInputSchema,
    outputSchema: HttpJsonSchema,
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/userinfo' },
  } as FlowMetadata<'oauth:userinfo'>;
}

type VerifyResultLike = {
  ok: boolean;
  sub?: string;
  payload?: Record<string, unknown>;
  error?: string;
  issuer?: string;
};

/**
 * Build a flow whose `scope.auth.verifyGatewayToken` returns `verifyResult`.
 * The Authorization header is set when `token` is provided.
 */
function makeFlow(verifyResult: VerifyResultLike, token?: string) {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } });
  // Inject a verifyGatewayToken stub onto the mock auth instance.
  (scope.auth as unknown as { verifyGatewayToken: jest.Mock }).verifyGatewayToken = jest
    .fn()
    .mockResolvedValue(verifyResult);

  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/userinfo', headers });

  return new OauthUserInfoFlow(createUserInfoMetadata(), input as never, scope as ScopeEntry, jest.fn(), new Map());
}

describe('OAuth UserInfo Flow — GET /oauth/userinfo', () => {
  it('returns 200 with sub + present claims for a VALID token', async () => {
    const flow = makeFlow(
      {
        ok: true,
        sub: 'user-123',
        payload: { sub: 'user-123', email: 'u@example.com', name: 'User', scope: 'read' },
      },
      'valid.jwt.token',
    );
    const { output } = await runFlowStages(flow, ['parseInput', 'verifyAndRespond']);
    expect(output?.kind).toBe('json');
    expect(output.status).toBe(200);
    expect(output.body.sub).toBe('user-123');
    expect(output.body.email).toBe('u@example.com');
    expect(output.body.name).toBe('User');
    // `scope` is NOT a userinfo claim and must not leak.
    expect(output.body.scope).toBeUndefined();
    // No picture claim present → omitted.
    expect(output.body.picture).toBeUndefined();
  });

  it('emits only sub when optional claims are absent', async () => {
    const flow = makeFlow({ ok: true, sub: 'anon-1', payload: { sub: 'anon-1' } }, 'valid.jwt.token');
    const { output } = await runFlowStages(flow, ['parseInput', 'verifyAndRespond']);
    expect(output.status).toBe(200);
    expect(output.body).toEqual({ sub: 'anon-1' });
  });

  it('returns 401 when the Authorization header is MISSING', async () => {
    const flow = makeFlow({ ok: true, sub: 'never', payload: { sub: 'never' } });
    const { output } = await runFlowStages(flow, ['parseInput', 'verifyAndRespond']);
    expect(output.status).toBe(401);
    expect(output.body.error).toBe('invalid_token');
    expect(output.headers?.['WWW-Authenticate']).toContain('Bearer');
  });

  it('returns 401 when the token FAILS verification (forged/tampered)', async () => {
    const flow = makeFlow({ ok: false, error: 'signature verification failed' }, 'forged.jwt.token');
    const { output } = await runFlowStages(flow, ['parseInput', 'verifyAndRespond']);
    expect(output.status).toBe(401);
    expect(output.body.error).toBe('invalid_token');
    expect(String(output.body.error_description)).toContain('signature');
  });

  it('returns 401 when a verified token carries NO subject', async () => {
    const flow = makeFlow({ ok: true, payload: { scope: 'read' } }, 'valid.jwt.token');
    const { output } = await runFlowStages(flow, ['parseInput', 'verifyAndRespond']);
    expect(output.status).toBe(401);
    expect(output.body.error).toBe('invalid_token');
  });
});
