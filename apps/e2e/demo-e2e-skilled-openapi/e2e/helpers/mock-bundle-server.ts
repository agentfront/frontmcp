import type { IncomingMessage, ServerResponse } from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';

import type { ResolvedBundle } from '@frontmcp/adapters/skills';

import type { TlsMaterial } from './production-environment';

/** The `iss` of the pull tokens the bundle server issues, and the `aud` it issues them for. */
export const BUNDLE_ISSUER = 'https://bundles.e2e.example';
export const BUNDLE_AUDIENCE = 'e2e:billing';

export const BUNDLE_PATH = '/v1/bundles/e2e-billing';
export const MOVED_BUNDLE_PATH = '/v1/bundles/e2e-billing-moved';
export const JWKS_PATH = '/.well-known/jwks.json';

/** When a token was issued and when it expires, as jose reads them: `'1h'`, `'2 hours ago'`. */
export interface TokenLifetime {
  issuedAt?: string;
  expiresAt: string;
}

const VALID_FOR_AN_HOUR: TokenLifetime = { expiresAt: '1h' };

/** The bundle server's token issuer: a signing key made for this run, and the JWKS that publishes it. */
export class PullTokenIssuer {
  private constructor(
    readonly jwks: { keys: JWK[] },
    private readonly kid: string,
    private readonly privateKey: CryptoKey,
  ) {}

  static async create(kid: string): Promise<PullTokenIssuer> {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
    return new PullTokenIssuer({ keys: [jwk] }, kid, privateKey);
  }

  /** A pull token for this run's server; `claims` replace its `iss` or `aud`. */
  pullToken(claims: JWTPayload = {}, lifetime: TokenLifetime = VALID_FOR_AN_HOUR): Promise<string> {
    return new SignJWT({ iss: BUNDLE_ISSUER, aud: BUNDLE_AUDIENCE, sub: 'e2e-billing-server', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid })
      .setIssuedAt(lifetime.issuedAt)
      .setExpirationTime(lifetime.expiresAt)
      .sign(this.privateKey);
  }
}

/** How the bundle server answers: normally, not at all (it drops every connection), or by redirecting a pull. */
export type BundleServerMode = 'serving' | 'outage' | 'redirecting';

export interface BundleServerRequest {
  path: string;
  authorization: string | undefined;
}

export interface MockBundleServer {
  readonly bundleUrl: string;
  readonly jwksUrl: string;
  /** What a pull receives: a bundle as JSON, or a string as it is. */
  published: ResolvedBundle | string;
  mode: BundleServerMode;
  requestsTo(path: string): BundleServerRequest[];
  /** Serve the bundle it started with, and forget the requests received. */
  reset(): void;
  stop(): Promise<void>;
}

export interface MockBundleServerOptions {
  tls: TlsMaterial;
  jwks: { keys: JWK[] };
  /** The only bearer token a pull may carry. */
  pullToken: string;
  published: ResolvedBundle;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/** A SaaS bundle server over HTTPS on loopback: it serves its JWKS, and the published bundle to the pull token. */
export async function startMockBundleServer(options: MockBundleServerOptions): Promise<MockBundleServer> {
  const requests: BundleServerRequest[] = [];
  let origin = '';

  const state: Pick<MockBundleServer, 'published' | 'mode'> = { published: options.published, mode: 'serving' };

  function servePull(req: IncomingMessage, res: ServerResponse): void {
    if (req.headers['authorization'] !== `Bearer ${options.pullToken}`) {
      return reply(res, 401, { error: 'invalid pull token' });
    }
    reply(res, 200, state.published);
  }

  const server = https.createServer(options.tls, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://localhost').pathname;
    requests.push({ path, authorization: req.headers['authorization'] });

    if (state.mode === 'outage') {
      req.socket.destroy();
      return;
    }
    if (req.method === 'GET' && path === JWKS_PATH) return reply(res, 200, options.jwks);
    if (req.method === 'GET' && path === BUNDLE_PATH && state.mode === 'redirecting') {
      res.statusCode = 302;
      res.setHeader('Location', `${origin}${MOVED_BUNDLE_PATH}`);
      res.end();
      return;
    }
    if (req.method === 'GET' && (path === BUNDLE_PATH || path === MOVED_BUNDLE_PATH)) return servePull(req, res);
    reply(res, 404, { error: 'no route', path });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  origin = `https://localhost:${port}`;

  return Object.assign(state, {
    bundleUrl: `${origin}${BUNDLE_PATH}`,
    jwksUrl: `${origin}${JWKS_PATH}`,
    requestsTo: (requestPath: string) => requests.filter((request) => request.path === requestPath),
    reset() {
      state.published = options.published;
      state.mode = 'serving';
      requests.length = 0;
    },
    stop() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}
