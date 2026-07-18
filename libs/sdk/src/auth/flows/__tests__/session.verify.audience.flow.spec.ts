/**
 * SessionVerifyFlow — transparent-mode audience validation (GHSA-hvvp-67p3-j379, flaw 2).
 *
 * `session:verify` is the flow the HTTP request pipeline actually runs
 * (http.request.flow.ts → runFlow('session:verify')). In transparent mode the
 * bearer token is verified against an EXTERNAL IdP's shared JWKS, so a valid
 * signature does NOT prove the token was minted for THIS resource. The `aud`
 * claim is the only binding to this server; the flow must reject a token whose
 * `aud` names a different service, otherwise a token issued to the same IdP for
 * service A can be replayed against service B unchanged.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '@frontmcp/auth';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpRequestInputSchema, type FlowMetadata } from '../../../common';
import SessionVerifyFlow, { sessionVerifyOutputSchema } from '../session.verify.flow';

const ISSUER = 'https://idp.example';
const VICTIM_HOST = 'victim.example';
const VICTIM_AUDIENCE = `http://${VICTIM_HOST}`;

function createMetadata(): FlowMetadata<'session:verify'> {
  return {
    name: 'session:verify',
    plan: { pre: ['parseInput', 'verifyIfJwt'], execute: [] },
    inputSchema: httpRequestInputSchema,
    outputSchema: sessionVerifyOutputSchema,
    access: 'authorized',
  } as unknown as FlowMetadata<'session:verify'>;
}

/**
 * Build a transparent-mode scope whose provider verifies against `providerJwks`
 * and whose JwksService is injected through the flow deps map.
 */
function createTransparentScope(
  providerJwks: { keys: JWK[] },
  expectedAudience?: string | string[],
  requireAudience?: boolean,
) {
  const scope = createMockScopeEntry({ auth: { mode: 'transparent' } as never });
  const auth = scope.auth as unknown as Record<string, unknown>;
  auth['issuer'] = ISSUER;
  auth['options'] = {
    mode: 'transparent',
    ...(expectedAudience !== undefined ? { expectedAudience } : {}),
    ...(requireAudience !== undefined ? { requireAudience } : {}),
    providerConfig: { id: 'idp', jwks: providerJwks },
  };
  return scope;
}

async function runVerify(opts: {
  jwt: string;
  providerJwks: { keys: JWK[] };
  expectedAudience?: string | string[];
  requireAudience?: boolean;
  forwardedHost?: string;
}) {
  const scope = createTransparentScope(opts.providerJwks, opts.expectedAudience, opts.requireAudience);
  const input = createMockHttpRequest({
    method: 'POST',
    path: '/',
    headers: {
      host: VICTIM_HOST,
      authorization: `Bearer ${opts.jwt}`,
      ...(opts.forwardedHost ? { 'x-forwarded-host': opts.forwardedHost, 'x-forwarded-proto': 'https' } : {}),
    },
  });
  const deps = new Map<unknown, unknown>([[JwksService, new JwksService()]]);
  const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), deps as never);
  return runFlowStages(flow, ['parseInput', 'verifyIfJwt']);
}

describe('SessionVerifyFlow — transparent audience validation (GHSA-hvvp-67p3-j379)', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let providerJwks: { keys: JWK[] };

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    const publicJwk = await exportJWK(kp.publicKey);
    publicJwk.kid = 'idp-kid';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    providerJwks = { keys: [publicJwk as JWK] };
  });

  function mint(claims: Record<string, unknown>): Promise<string> {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'idp-kid' })
      .setIssuer(ISSUER)
      .setExpirationTime('1h');
    return jwt.sign(privateKey);
  }

  it('rejects a validly-signed token whose aud names a different service', async () => {
    const jwt = await mint({ sub: 'user123', aud: 'http://service-a.example' });
    const { output } = await runVerify({ jwt, providerJwks });

    expect(output?.kind).toBe('unauthorized');
  });

  it('does NOT let X-Forwarded-Host steer the expected audience to the attacker token (GHSA follow-up)', async () => {
    // Attacker holds a token minted for service-a and tries to satisfy the gate
    // by spoofing X-Forwarded-Host to service-a's host. Since forwarded headers
    // are ignored by default, the expected audience stays this resource → reject.
    const jwt = await mint({ sub: 'user123', aud: 'https://service-a.example' });
    const { output } = await runVerify({ jwt, providerJwks, forwardedHost: 'service-a.example' });

    expect(output?.kind).toBe('unauthorized');
  });

  it('accepts a token whose aud matches this resource (host-derived)', async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output, error } = await runVerify({ jwt, providerJwks });

    // No respond → the stage falls through to later stages (audience + scopes ok).
    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('rejects a token whose aud is the bare, scheme-less host (broadening removed)', async () => {
    // deriveExpectedAudience no longer emits the scheme-less host form, so a
    // token bound only to `victim.example` (no scheme/path) is not accepted —
    // it could otherwise authorize at every scheme/path on that host.
    const jwt = await mint({ sub: 'user123', aud: VICTIM_HOST });
    const { output } = await runVerify({ jwt, providerJwks });

    expect(output?.kind).toBe('unauthorized');
  });

  it('accepts a token with no aud claim (allowNoAudience — IdP compatibility)', async () => {
    const jwt = await mint({ sub: 'user123' });
    const { output, error } = await runVerify({ jwt, providerJwks });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('rejects a token with no aud claim when requireAudience is true', async () => {
    const jwt = await mint({ sub: 'user123' });
    const { output } = await runVerify({ jwt, providerJwks, requireAudience: true });

    expect(output?.kind).toBe('unauthorized');
  });

  it('still accepts a token whose aud matches when requireAudience is true', async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output, error } = await runVerify({ jwt, providerJwks, requireAudience: true });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('rejects when aud matches none of a token carrying multiple wrong audiences', async () => {
    const jwt = await mint({ sub: 'user123', aud: ['http://a.example', 'http://b.example'] });
    const { output } = await runVerify({ jwt, providerJwks });

    expect(output?.kind).toBe('unauthorized');
  });

  it('honors an explicitly configured expectedAudience over the derived one', async () => {
    const jwt = await mint({ sub: 'user123', aud: 'urn:acme:mcp' });
    const accepted = await runVerify({ jwt, providerJwks, expectedAudience: 'urn:acme:mcp' });
    expect(accepted.output).toBeUndefined();
    expect(accepted.error).toBeUndefined();

    // Same token is rejected when the configured audience differs.
    const rejected = await runVerify({ jwt, providerJwks, expectedAudience: 'urn:other:mcp' });
    expect(rejected.output?.kind).toBe('unauthorized');
  });
});
