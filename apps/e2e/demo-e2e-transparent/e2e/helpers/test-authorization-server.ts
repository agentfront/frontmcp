import { createServer, type Server } from 'node:http';

import { verifyPkce } from '@frontmcp/auth';

export interface TestAuthorizationServer {
  issuer: string;
  /** Every request's path and parameters (query for GET, form body for POST). */
  requests: { path: string; params: URLSearchParams }[];
  metadata: Record<string, unknown>;
  /** Extra parameters the authorization endpoint adds to its redirect (`error`, `iss`, a wrong `state`). */
  redirectExtras: Record<string, string>;
  refreshTokens: Set<string>;
  expiresIn: number;
  close(): Promise<void>;
}

/** A small RFC 8414 authorization server that approves every request, checks S256 PKCE and rotates refresh tokens. */
export async function startTestAuthorizationServer(): Promise<TestAuthorizationServer> {
  const codes = new Map<string, { challenge: string; method: string; redirectUri: string }>();
  let counter = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', state.issuer);
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const params = req.method === 'POST' ? new URLSearchParams(raw) : url.searchParams;
      state.requests.push({ path: url.pathname, params });
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (url.pathname === '/.well-known/oauth-authorization-server') return json(200, state.metadata);
      if (url.pathname === '/authorize') {
        const redirect = new URL(params.get('redirect_uri') as string);
        const code = `code-${++counter}`;
        codes.set(code, {
          challenge: params.get('code_challenge') ?? '',
          method: params.get('code_challenge_method') ?? '',
          redirectUri: redirect.toString(),
        });
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', params.get('state') ?? '');
        for (const [name, value] of Object.entries(state.redirectExtras)) redirect.searchParams.set(name, value);
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }
      if (url.pathname === '/token') {
        const grant = params.get('grant_type');
        if (grant === 'authorization_code') {
          const record = codes.get(params.get('code') ?? '');
          codes.delete(params.get('code') ?? '');
          const verified =
            record &&
            record.redirectUri === params.get('redirect_uri') &&
            verifyPkce(params.get('code_verifier') ?? '', {
              challenge: record.challenge,
              method: record.method as 'S256',
            });
          if (!verified) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        } else if (grant === 'refresh_token') {
          if (!state.refreshTokens.delete(params.get('refresh_token') ?? ''))
            return json(400, { error: 'invalid_grant' });
        } else {
          return json(400, { error: 'unsupported_grant_type' });
        }
        const refreshToken = `refresh-${++counter}`;
        state.refreshTokens.add(refreshToken);
        return json(200, {
          access_token: `access-${counter}`,
          token_type: 'Bearer',
          expires_in: state.expiresIn,
          refresh_token: refreshToken,
          scope: 'notes:read',
        });
      }
      json(404, { error: 'not_found' });
    });
  });
  // A refused bind (a sandbox without loopback) fails the start instead of leaving it pending.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const issuer = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const state: TestAuthorizationServer = {
    issuer,
    requests: [],
    metadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      code_challenge_methods_supported: ['S256'],
    },
    redirectExtras: {},
    refreshTokens: new Set(),
    expiresIn: 3600,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return state;
}

/** Plays the browser: follows the authorization endpoint's redirect to the loopback listener. */
export async function followRedirect(authorizationUrl: string): Promise<Response> {
  const response = await fetch(authorizationUrl, { redirect: 'manual' });
  return fetch(response.headers.get('location') as string);
}
