/**
 * UserInfo Endpoint — GET /oauth/userinfo
 *
 * Who calls: a client holding a FrontMCP-issued access token.
 *
 * When: after obtaining an access token via /oauth/token, to resolve the
 * authenticated user's claims (OIDC userinfo-style).
 *
 * Purpose: verify the Bearer token's HS256 signature + lifetime via the
 * auth instance's {@link LocalPrimaryAuth.verifyGatewayToken} and return the
 * user claims (`sub`, plus `email`/`name`/`picture` when present) as JSON.
 * Returns 401 when the Authorization header is missing or the token fails
 * verification.
 *
 * This endpoint backs the `userinfo_endpoint` advertised by the
 * oauth-authorization-server discovery document in orchestrated/local mode.
 */
import 'reflect-metadata';

import { extractBearerToken } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  getRequestBaseUrl,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import type { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  token: z.string().optional(),
  baseUrl: z.string().min(1),
});

const outputSchema = HttpJsonSchema;

const plan = {
  pre: ['parseInput'],
  execute: ['verifyAndRespond'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:userinfo': FlowRunOptions<
      OauthUserInfoFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:userinfo' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/userinfo',
  },
})
export default class OauthUserInfoFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthUserInfoFlow');

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const authorizationHeader = (request.headers?.['authorization'] as string | undefined) ?? undefined;
    const token = extractBearerToken(authorizationHeader);
    const baseUrl = getRequestBaseUrl(request, this.scope.entryPath);
    this.state.set({ token, baseUrl });
  }

  @Stage('verifyAndRespond')
  async verifyAndRespond() {
    // `token` is optional (may be absent); only `baseUrl` is guaranteed present.
    const { token } = this.state;
    const { baseUrl } = this.state.required;

    // No Bearer token → 401 (RFC 6750).
    if (!token) {
      this.logger.warn('userinfo: missing bearer token, returning 401');
      this.respond(
        httpRespond.unauthorized({
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
          body: { error: 'invalid_token', error_description: 'Missing bearer token' },
        }),
      );
      return;
    }

    // Verify the HS256 signature + lifetime using the auth instance's own
    // secret (the sole holder of the signing key). Issuer is accepted for
    // parity/logging only — proxy/tunnel deployments legitimately differ.
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const result = await localAuth.verifyGatewayToken(token, baseUrl);

    if (!result.ok) {
      this.logger.warn('userinfo: token verification failed', { error: result.error });
      this.respond(
        httpRespond.unauthorized({
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
          body: { error: 'invalid_token', error_description: result.error ?? 'Token verification failed' },
        }),
      );
      return;
    }

    const payload = result.payload ?? {};
    const sub = (payload['sub'] as string | undefined) ?? result.sub;
    if (!sub) {
      this.logger.warn('userinfo: verified token has no subject, returning 401');
      this.respond(
        httpRespond.unauthorized({
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
          body: { error: 'invalid_token', error_description: 'Token has no subject' },
        }),
      );
      return;
    }

    // Standard OIDC userinfo claims — only emit optional claims when present.
    const body: Record<string, unknown> = { sub };
    if (typeof payload['email'] === 'string') body['email'] = payload['email'];
    if (typeof payload['name'] === 'string') body['name'] = payload['name'];
    if (typeof payload['picture'] === 'string') body['picture'] = payload['picture'];

    this.respond(httpRespond.json(body));
  }
}
