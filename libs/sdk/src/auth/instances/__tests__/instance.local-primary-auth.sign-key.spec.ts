import 'reflect-metadata';

import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type JWK,
} from 'jose';

import { JwksService } from '@frontmcp/auth';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  const activeScope = {
    logger,
    metadata: { http: { port: 3001 } },
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  const injectProvider = jest.fn();
  return {
    registry: {
      getActiveScope: () => activeScope,
      injectProvider,
      addDynamicProviders: jest.fn().mockResolvedValue(undefined),
    } as never,
    injectProvider,
  };
}

async function makeAuth(options: Record<string, unknown>) {
  const providers = createProviders();
  const auth = new LocalPrimaryAuth(
    { fullPath: '', onDispose: jest.fn() } as never,
    providers.registry,
    options as never,
  );
  await auth.ready;
  const jwksService = providers.injectProvider.mock.calls
    .map(([provider]) => provider as { provide: unknown; value: unknown })
    .find((provider) => provider.provide === JwksService)?.value as JwksService;
  return { auth, jwksService };
}

async function rsaPrivateJwk(kid?: string): Promise<JWK> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { ...(await exportJWK(privateKey)), ...(kid ? { kid } : {}) };
}

const BASE_URL = 'http://localhost:3001';

describe('LocalPrimaryAuth signKey and jwks', () => {
  it('signs access tokens with auth.local.signKey and serves its public key at /.well-known/jwks.json', async () => {
    const { auth, jwksService } = await makeAuth({ mode: 'local', local: { signKey: await rsaPrivateJwk('k1') } });

    const token = await auth.signAccessToken({ sub: 'user-1' }, ['read']);
    const published = await jwksService.getPublicJwks();

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    expect(published.keys).toHaveLength(1);
    expect(published.keys[0]).not.toHaveProperty('d');
    await expect(jwtVerify(token, createLocalJWKSet(published))).resolves.toBeDefined();
    await expect(auth.verifyGatewayToken(token, BASE_URL)).resolves.toMatchObject({ ok: true, sub: 'user-1' });
  });

  it("signs public mode's anonymous tokens with its signKey", async () => {
    const { auth, jwksService } = await makeAuth({ mode: 'public', signKey: await rsaPrivateJwk() });

    const token = await auth.signAnonymousJwt();

    expect(decodeProtectedHeader(token).alg).toBe('RS256');
    await expect(jwtVerify(token, createLocalJWKSet(await jwksService.getPublicJwks()))).resolves.toBeDefined();
    await expect(auth.verifyGatewayToken(token, BASE_URL)).resolves.toMatchObject({ ok: true });
  });

  it('accepts tokens signed by a retired key listed in auth.local.jwks', async () => {
    const retired = await generateKeyPair('ES256', { extractable: true });
    const { auth, jwksService } = await makeAuth({
      mode: 'local',
      local: {
        signKey: await rsaPrivateJwk('current'),
        jwks: { keys: [{ ...(await exportJWK(retired.publicKey)), kid: 'retired' }] },
      },
    });
    const oldToken = await new SignJWT({ sub: 'user-0' })
      .setProtectedHeader({ alg: 'ES256', kid: 'retired' })
      .setIssuer(auth.issuer)
      .setExpirationTime('1h')
      .sign(retired.privateKey);

    expect((await jwksService.getPublicJwks()).keys.map((key) => key.kid)).toEqual(['current', 'retired']);
    await expect(auth.verifyGatewayToken(oldToken, BASE_URL)).resolves.toMatchObject({ ok: true, sub: 'user-0' });
  });

  it('refuses an HS256 token signed with JWT_SECRET once a signKey signs', async () => {
    const { auth } = await makeAuth({ mode: 'local', local: { signKey: await rsaPrivateJwk() } });
    const hmacToken = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(auth.issuer)
      .setExpirationTime('1h')
      .sign(auth.secret);

    await expect(auth.verifyGatewayToken(hmacToken, BASE_URL)).resolves.toMatchObject({ ok: false });
  });

  it('publishes no key while tokens are HS256 with JWT_SECRET', async () => {
    const { auth, jwksService } = await makeAuth({ mode: 'local' });

    const token = await auth.signAccessToken({ sub: 'user-1' }, []);

    expect(decodeProtectedHeader(token).alg).toBe('HS256');
    expect(await jwksService.getPublicJwks()).toEqual({ keys: [] });
  });

  it('refuses to start with auth.local.jwks and no asymmetric signKey', async () => {
    const { publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwks = { keys: [await exportJWK(publicKey)] };

    await expect(makeAuth({ mode: 'local', local: { jwks } })).rejects.toThrow(
      'auth.local.jwks is set, but tokens are signed with an HMAC key',
    );
  });

  it("refuses to start with a public key as public mode's signKey", async () => {
    const { publicKey } = await generateKeyPair('RS256', { extractable: true });

    await expect(makeAuth({ mode: 'public', signKey: await exportJWK(publicKey) })).rejects.toThrow(
      'auth.signKey is a public key',
    );
  });
});
