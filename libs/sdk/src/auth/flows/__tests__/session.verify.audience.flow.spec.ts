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
  audienceFromRequestHost?: boolean,
) {
  const scope = createMockScopeEntry({ auth: { mode: 'transparent' } as never });
  const auth = scope.auth as unknown as Record<string, unknown>;
  auth['issuer'] = ISSUER;
  auth['options'] = {
    mode: 'transparent',
    ...(expectedAudience !== undefined ? { expectedAudience } : {}),
    ...(requireAudience !== undefined ? { requireAudience } : {}),
    ...(audienceFromRequestHost !== undefined ? { audienceFromRequestHost } : {}),
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
  allowedHosts?: string[];
  protectionOff?: boolean;
  audienceFromRequestHost?: boolean;
}) {
  const scope = createTransparentScope(
    opts.providerJwks,
    opts.expectedAudience,
    opts.requireAudience,
    opts.audienceFromRequestHost,
  );
  if (opts.allowedHosts) {
    const http = scope.metadata.http as Record<string, unknown>;
    http['security'] = {
      dnsRebindingProtection: { allowedHosts: opts.allowedHosts, ...(opts.protectionOff && { enabled: false }) },
    };
  }
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

  /** Run with NODE_ENV set to `nodeEnv`, or unset. */
  async function withNodeEnv<T>(nodeEnv: string | undefined, run: () => Promise<T>): Promise<T> {
    const original = process.env['NODE_ENV'];
    if (nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = nodeEnv;
    try {
      return await run();
    } finally {
      process.env['NODE_ENV'] = original;
    }
  }

  // With audienceFromRequestHost the request host decides, so these show it is the request's own Host that does.
  it('rejects a validly-signed token whose aud names a different service', async () => {
    const jwt = await mint({ sub: 'user123', aud: 'http://service-a.example' });
    const { output } = await runVerify({ jwt, providerJwks, audienceFromRequestHost: true });

    expect(output?.kind).toBe('unauthorized');
  });

  it('does NOT let X-Forwarded-Host steer the expected audience to the attacker token (GHSA follow-up)', async () => {
    // Attacker holds a token minted for service-a and tries to satisfy the gate
    // by spoofing X-Forwarded-Host to service-a's host. Since forwarded headers
    // are ignored by default, the expected audience stays this resource → reject.
    const jwt = await mint({ sub: 'user123', aud: 'https://service-a.example' });
    const { output } = await runVerify({
      jwt,
      providerJwks,
      forwardedHost: 'service-a.example',
      audienceFromRequestHost: true,
    });

    expect(output?.kind).toBe('unauthorized');
  });

  it('accepts a token for a host listed in FRONTMCP_ALLOWED_HOSTS', async () => {
    process.env['FRONTMCP_ALLOWED_HOSTS'] = `other.example, ${VICTIM_HOST.toUpperCase()}`;
    try {
      const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
      const { output, error } = await runVerify({ jwt, providerJwks });

      expect(output).toBeUndefined();
      expect(error).toBeUndefined();
    } finally {
      delete process.env['FRONTMCP_ALLOWED_HOSTS'];
    }
  });

  it('accepts a token for the host the server is configured to answer under (allowedHosts)', async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output, error } = await runVerify({ jwt, providerJwks, allowedHosts: [VICTIM_HOST] });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('checks the audience against the pinned FRONTMCP_PUBLIC_URL, whatever the Host header says', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example';
    try {
      const pinned = await runVerify({ jwt: await mint({ sub: 'user123', aud: 'https://mcp.example' }), providerJwks });
      expect(pinned.output).toBeUndefined();
      expect(pinned.error).toBeUndefined();

      const hostDerived = await runVerify({ jwt: await mint({ sub: 'user123', aud: VICTIM_AUDIENCE }), providerJwks });
      expect(hostDerived.output?.kind).toBe('unauthorized');
    } finally {
      delete process.env['FRONTMCP_PUBLIC_URL'];
    }
  });

  it("refuses a token for the request's host when nothing configures the audience", async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output } = await runVerify({ jwt, providerJwks });

    expect(output?.kind).toBe('unauthorized');
  });

  it("refuses a token for the request's host when it is listed but DNS-rebinding protection is off", async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output } = await runVerify({ jwt, providerJwks, allowedHosts: [VICTIM_HOST], protectionOff: true });

    expect(output?.kind).toBe('unauthorized');
  });

  it("accepts a token for the request's host with audienceFromRequestHost (host-derived, as 1.12 did)", async () => {
    const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
    const { output, error } = await runVerify({ jwt, providerJwks, audienceFromRequestHost: true });

    // No respond → the stage falls through to later stages (audience + scopes ok).
    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it("accepts a token for the server's loopback address when nothing is configured, in tests and development", async () => {
    for (const aud of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
      const { output, error } = await runVerify({ jwt: await mint({ sub: 'user123', aud }), providerJwks });
      expect(output).toBeUndefined();
      expect(error).toBeUndefined();
    }
    const otherPort = await runVerify({
      jwt: await mint({ sub: 'user123', aud: 'http://localhost:4000' }),
      providerJwks,
    });
    expect(otherPort.output?.kind).toBe('unauthorized');
  });

  it.each([['production'], ['staging'], [undefined]])(
    'refuses every token that names an audience when nothing is configured and NODE_ENV is %s',
    async (nodeEnv) => {
      await withNodeEnv(nodeEnv, async () => {
        const loopback = await runVerify({
          jwt: await mint({ sub: 'user123', aud: 'http://localhost:3001' }),
          providerJwks,
        });
        expect(loopback.output?.kind).toBe('unauthorized');

        const withoutAudience = await runVerify({ jwt: await mint({ sub: 'user123' }), providerJwks });
        expect(withoutAudience.output).toBeUndefined();
        expect(withoutAudience.error).toBeUndefined();
      });
    },
  );

  it("accepts a token for the request's host with audienceFromRequestHost in production too", async () => {
    await withNodeEnv('production', async () => {
      const jwt = await mint({ sub: 'user123', aud: VICTIM_AUDIENCE });
      const { output, error } = await runVerify({ jwt, providerJwks, audienceFromRequestHost: true });

      expect(output).toBeUndefined();
      expect(error).toBeUndefined();
    });
  });

  it('rejects a token whose aud is the bare, scheme-less host (broadening removed)', async () => {
    // deriveExpectedAudience no longer emits the scheme-less host form, so a
    // token bound only to `victim.example` (no scheme/path) is not accepted —
    // it could otherwise authorize at every scheme/path on that host.
    const jwt = await mint({ sub: 'user123', aud: VICTIM_HOST });
    const { output } = await runVerify({ jwt, providerJwks, allowedHosts: [VICTIM_HOST] });

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
    const { output, error } = await runVerify({
      jwt,
      providerJwks,
      requireAudience: true,
      allowedHosts: [VICTIM_HOST],
    });

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
