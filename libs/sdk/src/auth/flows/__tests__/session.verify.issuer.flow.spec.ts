/**
 * SessionVerifyFlow — transparent-mode issuer validation + opt-out plumbing
 * (GHSA-hvvp-67p3-j379, flaw 1).
 *
 * The live `session:verify` flow must reject a transparent-mode token whose
 * `iss` differs from the configured provider issuer — a valid signature from
 * the shared IdP JWKS is not proof the token was minted for this issuer. It
 * must also honor the deliberate `providerConfig.verifyIssuer: false` opt-out
 * that a trusted gateway (which re-mints tokens under an unpredictable issuer)
 * needs, verifying by default when the flag is omitted.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '@frontmcp/auth';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpRequestInputSchema, type FlowMetadata } from '../../../common';
import SessionVerifyFlow, { sessionVerifyOutputSchema } from '../session.verify.flow';

const CONFIGURED_ISSUER = 'https://idp.example';
const VICTIM_HOST = 'victim.example';

function createMetadata(): FlowMetadata<'session:verify'> {
  return {
    name: 'session:verify',
    plan: { pre: ['parseInput', 'verifyIfJwt'], execute: [] },
    inputSchema: httpRequestInputSchema,
    outputSchema: sessionVerifyOutputSchema,
    access: 'authorized',
  } as unknown as FlowMetadata<'session:verify'>;
}

async function runVerify(opts: {
  jwt: string;
  providerJwks: { keys: JWK[] };
  verifyIssuer?: boolean;
  additionalIssuers?: string[];
}) {
  const scope = createMockScopeEntry({ auth: { mode: 'transparent' } as never });
  const auth = scope.auth as unknown as Record<string, unknown>;
  auth['issuer'] = CONFIGURED_ISSUER;
  auth['options'] = {
    mode: 'transparent',
    providerConfig: {
      id: 'idp',
      jwks: opts.providerJwks,
      ...(opts.verifyIssuer !== undefined ? { verifyIssuer: opts.verifyIssuer } : {}),
      ...(opts.additionalIssuers ? { additionalIssuers: opts.additionalIssuers } : {}),
    },
  };

  const input = createMockHttpRequest({
    method: 'POST',
    path: '/',
    headers: { host: VICTIM_HOST, authorization: `Bearer ${opts.jwt}` },
  });
  const deps = new Map<unknown, unknown>([[JwksService, new JwksService()]]);
  const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), deps as never);
  return runFlowStages(flow, ['parseInput', 'verifyIfJwt']);
}

describe('SessionVerifyFlow — transparent issuer validation (GHSA-hvvp-67p3-j379)', () => {
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

  function mint(issuer: string): Promise<string> {
    // Audience matches the victim host so only the issuer decision is under test.
    return new SignJWT({ sub: 'user123', aud: `http://${VICTIM_HOST}` })
      .setProtectedHeader({ alg: 'RS256', kid: 'idp-kid' })
      .setIssuer(issuer)
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('rejects a validly-signed token whose iss differs from the configured issuer', async () => {
    const jwt = await mint('https://attacker.example');
    const { output } = await runVerify({ jwt, providerJwks });

    expect(output?.kind).toBe('unauthorized');
  });

  it('accepts a token whose iss matches the configured issuer (default verify)', async () => {
    const jwt = await mint(CONFIGURED_ISSUER);
    const { output, error } = await runVerify({ jwt, providerJwks });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('accepts a foreign iss when providerConfig.verifyIssuer is false (opt-out plumbed through)', async () => {
    const jwt = await mint('https://gateway-rewritten.example');
    const { output, error } = await runVerify({ jwt, providerJwks, verifyIssuer: false });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });

  it('accepts a foreign iss that is explicitly allowlisted via additionalIssuers', async () => {
    const jwt = await mint('https://gateway.example');
    const { output, error } = await runVerify({
      jwt,
      providerJwks,
      additionalIssuers: ['https://gateway.example'],
    });

    expect(output).toBeUndefined();
    expect(error).toBeUndefined();
  });
});
