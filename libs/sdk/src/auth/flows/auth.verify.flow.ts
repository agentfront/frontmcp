// auth/flows/auth.verify.flow.ts

import { Flow, FlowBase, FlowRunOptions, StageHookOf, httpRequestInputSchema, FlowPlan } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { getRequestBaseUrl, normalizeEntryPrefix, normalizeScopeBase } from '../path.utils';
import { deriveTypedUser, extractBearerToken, isJwt } from '../session/utils/auth-token.utils';
import { JwksService, ProviderVerifyRef, VerifyResult } from '../jwks';
import type { JSONWebKeySet } from 'jose';
import {
  buildPrmUrl,
  buildUnauthorizedHeader,
  buildInvalidTokenHeader,
  buildInsufficientScopeHeader,
} from '../utils/www-authenticate.utils';
import { validateAudience, deriveExpectedAudience } from '../utils/audience.validator';
import {
  PublicAuthorization,
  TransparentAuthorization,
  OrchestratedAuthorization,
  Authorization,
  TransparentVerifiedPayload,
} from '../authorization';
import { AuthMode } from '../authorization/authorization.types';
import { authUserSchema, llmSafeAuthContextSchema } from '../authorization/authorization.types';

// Input schema
const inputSchema = httpRequestInputSchema;

// State schema for the flow
const stateSchema = z.object({
  baseUrl: z.string().min(1),
  authorizationHeader: z.string().optional(),
  token: z.string().optional(),
  sessionIdHeader: z.string().optional(),
  prmUrl: z.string(),
  wwwAuthenticateHeader: z.string(),
  authMode: z.enum(['public', 'transparent', 'orchestrated']).optional(),
  jwtPayload: z.object({}).passthrough().optional(),
  user: authUserSchema.optional(),
});

// Output schemas
const UnauthorizedSchema = z
  .object({
    kind: z.literal('unauthorized'),
    wwwAuthenticateHeader: z.string().describe('WWW-Authenticate header per RFC 9728'),
    reason: z.string().optional().describe('Human-readable reason for rejection'),
  })
  .describe('401 Unauthorized response');

const AuthorizedSchema = z
  .object({
    kind: z.literal('authorized'),
    authorization: z.custom<Authorization>().describe('Authorization object'),
    llmContext: llmSafeAuthContextSchema.optional().describe('LLM-safe context (no tokens)'),
  })
  .describe('Authorized response with Authorization object');

export const authVerifyOutputSchema = z.union([UnauthorizedSchema, AuthorizedSchema]);

export type AuthVerifyOutput = z.infer<typeof authVerifyOutputSchema>;

// Flow plan
const plan = {
  pre: ['parseInput', 'determineAuthMode', 'handlePublicMode', 'requireAuthorizationHeader', 'verifyToken'],
  execute: ['buildAuthorization'],
} as const satisfies FlowPlan<string>;

// Declare flow types
declare global {
  interface ExtendFlows {
    'auth:verify': FlowRunOptions<
      AuthVerifyFlow,
      typeof plan,
      typeof inputSchema,
      typeof authVerifyOutputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'auth:verify' as const;
const Stage = StageHookOf(name);

/**
 * Auth Verify Flow
 *
 * New authorization verification flow that supports the three auth modes:
 * - public: Auto-generate anonymous authorization
 * - transparent: Pass-through OAuth tokens from upstream provider
 * - orchestrated: Local auth server with secure token storage
 *
 * This flow creates Authorization objects instead of legacy Session objects.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema: authVerifyOutputSchema,
  access: 'authorized',
})
export default class AuthVerifyFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('AuthVerifyFlow');

  /**
   * Parse request headers and build WWW-Authenticate header
   */
  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const entryPath = normalizeEntryPrefix(this.scope.entryPath);
    const routeBase = normalizeScopeBase(this.scope.routeBase);
    const baseUrl = getRequestBaseUrl(request, entryPath);

    // Extract headers
    const authorizationHeader = (request.headers?.['authorization'] as string | undefined) ?? undefined;
    const sessionIdHeader =
      (request.headers?.['mcp-session-id'] as string | undefined) ??
      (request.query['sessionId'] as string | undefined) ??
      undefined;

    // Build PRM URL and WWW-Authenticate header
    const prmUrl = buildPrmUrl(baseUrl, entryPath, routeBase);
    const wwwAuthenticateHeader = buildUnauthorizedHeader(prmUrl);

    const token = extractBearerToken(authorizationHeader);

    this.state.set({
      baseUrl,
      authorizationHeader,
      token,
      sessionIdHeader,
      prmUrl,
      wwwAuthenticateHeader,
    });
  }

  /**
   * Determine which auth mode to use based on scope configuration
   */
  @Stage('determineAuthMode')
  async determineAuthMode() {
    const authOptions = this.scope.auth?.options;

    // Determine auth mode from options
    let authMode: AuthMode = 'public'; // default

    if (authOptions && 'mode' in authOptions) {
      authMode = authOptions.mode as AuthMode;
    }

    this.logger.debug(`Auth mode determined: ${authMode}`);
    this.state.set('authMode', authMode);
  }

  /**
   * Handle public mode - create anonymous authorization without requiring a token
   */
  @Stage('handlePublicMode', {
    filter: ({ state }) => state.authMode === 'public' && !state.token,
  })
  async handlePublicMode() {
    const authOptions = this.scope.auth?.options as Record<string, unknown> | undefined;

    // Create anonymous authorization
    const publicAccess = authOptions?.['publicAccess'] as Record<string, unknown> | undefined;
    const authorization = PublicAuthorization.create({
      scopes: (authOptions?.['anonymousScopes'] as string[] | undefined) ?? ['anonymous'],
      ttlMs: this.parseTtl(authOptions?.['sessionTtl'] as string | number | undefined),
      issuer: (authOptions?.['issuer'] as string | undefined) ?? this.state.required.baseUrl,
      allowedTools: (publicAccess?.['tools'] as string[] | 'all' | undefined) ?? 'all',
      allowedPrompts: (publicAccess?.['prompts'] as string[] | 'all' | undefined) ?? 'all',
    });

    this.logger.info(`Created anonymous authorization: ${authorization.id}`);

    this.respond({
      kind: 'authorized',
      authorization,
    });
  }

  /**
   * Require authorization header for non-public modes
   */
  @Stage('requireAuthorizationHeader', {
    filter: ({ state }) => state.authMode !== 'public' && !state.authorizationHeader,
  })
  async requireAuthorizationHeader() {
    this.logger.warn('No authorization header provided');
    this.respond({
      kind: 'unauthorized',
      wwwAuthenticateHeader: this.state.required.wwwAuthenticateHeader,
      reason: 'No authorization header provided',
    });
  }

  /**
   * Verify the JWT token
   */
  @Stage('verifyToken', {
    filter: ({ state }) => !!state.token,
  })
  async verifyToken() {
    const jwks = this.get(JwksService);
    const token = this.state.required.token;
    const authMode = this.state.required.authMode;
    const { baseUrl, prmUrl } = this.state.required;

    // Non-JWT tokens are not supported
    if (!isJwt(token)) {
      this.logger.warn('Token is not a JWT');
      this.respond({
        kind: 'unauthorized',
        wwwAuthenticateHeader: buildInvalidTokenHeader(prmUrl, 'Token is not a valid JWT'),
        reason: 'Token is not a valid JWT',
      });
      return;
    }

    // Verify based on auth mode
    let verifyResult: VerifyResult;

    if (authMode === 'orchestrated') {
      // Orchestrated: verify against local keys
      verifyResult = await jwks.verifyGatewayToken(token, baseUrl);
    } else {
      // Transparent: verify against upstream provider
      const authOptions = this.scope.auth?.options as Record<string, unknown> | undefined;
      const providerRefs: ProviderVerifyRef[] = [
        {
          id: (authOptions?.['id'] as string | undefined) ?? 'default',
          issuerUrl: this.scope.auth?.issuer ?? '',
          jwks: authOptions?.['jwks'] as JSONWebKeySet | undefined,
          jwksUri: authOptions?.['jwksUri'] as string | undefined,
        },
      ];
      verifyResult = await jwks.verifyTransparentToken(token, providerRefs);
    }

    if (!verifyResult.ok) {
      this.logger.warn(`Token verification failed: ${verifyResult.error}`);
      this.respond({
        kind: 'unauthorized',
        wwwAuthenticateHeader: buildInvalidTokenHeader(prmUrl, verifyResult.error),
        reason: verifyResult.error ?? 'Token verification failed',
      });
      return;
    }

    // Validate audience
    const authOptionsForAudience = this.scope.auth?.options as Record<string, unknown> | undefined;
    const expectedAudience =
      (authOptionsForAudience?.['expectedAudience'] as string | string[] | undefined) ??
      deriveExpectedAudience(baseUrl);
    const expectedAudienceArray = Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience];

    const audResult = validateAudience(verifyResult.payload?.aud as string | string[] | undefined, {
      expectedAudiences: expectedAudienceArray,
      allowNoAudience: true, // Some tokens may not have audience
    });

    if (!audResult.valid) {
      this.logger.warn(`Audience validation failed: ${audResult.error}`);
      this.respond({
        kind: 'unauthorized',
        wwwAuthenticateHeader: buildInvalidTokenHeader(prmUrl, audResult.error),
        reason: audResult.error,
      });
      return;
    }

    // Check required scopes
    const requiredScopes = (authOptionsForAudience?.['requiredScopes'] as string[] | undefined) ?? [];
    if (requiredScopes.length > 0) {
      const tokenScopes = this.parseScopes(verifyResult.payload?.scope);
      const hasAllScopes = requiredScopes.every((s: string) => tokenScopes.includes(s));

      if (!hasAllScopes) {
        this.logger.warn(`Insufficient scopes. Required: ${requiredScopes.join(', ')}`);
        this.respond({
          kind: 'unauthorized',
          wwwAuthenticateHeader: buildInsufficientScopeHeader(prmUrl, requiredScopes),
          reason: `Missing required scopes: ${requiredScopes.join(', ')}`,
        });
        return;
      }
    }

    // Store verified payload and user
    const user = deriveTypedUser(verifyResult.payload ?? {});
    this.state.set({
      jwtPayload: verifyResult.payload,
      user,
    });
  }

  /**
   * Build the Authorization object based on auth mode
   */
  @Stage('buildAuthorization')
  async buildAuthorization() {
    const { token, jwtPayload, user, authMode, baseUrl } = this.state.required;

    if (!user) {
      this.respond({
        kind: 'unauthorized',
        wwwAuthenticateHeader: this.state.required.wwwAuthenticateHeader,
        reason: 'Failed to derive user from token',
      });
      return;
    }

    let authorization: Authorization;

    if (authMode === 'transparent') {
      // Transparent mode: pass-through token
      const authOptions = this.scope.auth?.options as Record<string, unknown> | undefined;
      // jwtPayload has been verified and should contain sub from the upstream token
      const payload = jwtPayload as TransparentVerifiedPayload;
      authorization = TransparentAuthorization.fromVerifiedToken({
        token,
        payload,
        providerId: this.scope.auth?.id ?? 'default',
        providerName: authOptions?.['name'] as string | undefined,
      });
    } else if (authMode === 'orchestrated') {
      // Orchestrated mode: local auth server
      // TODO: Retrieve token store from scope configuration
      authorization = OrchestratedAuthorization.create({
        token,
        user: {
          sub: user.sub ?? 'unknown',
          name: user.name,
          email: user.email,
          picture: user.picture,
        },
        scopes: this.parseScopes(jwtPayload?.['scope']),
        claims: jwtPayload,
        expiresAt: jwtPayload?.['exp'] ? (jwtPayload['exp'] as number) * 1000 : undefined,
        primaryProviderId: this.scope.auth?.id ?? 'default',
        // tokenStore will be injected by scope
      });
    } else {
      // Public mode with token (authenticated public)
      authorization = PublicAuthorization.create({
        scopes: this.parseScopes(jwtPayload?.['scope']) || ['anonymous'],
        ttlMs: jwtPayload?.['exp'] ? (jwtPayload['exp'] as number) * 1000 - Date.now() : 3600000,
        issuer: baseUrl,
      });
    }

    this.logger.info(`Authorization created: ${authorization.id} (mode: ${authMode})`);

    this.respond({
      kind: 'authorized',
      authorization,
    });
  }

  /**
   * Parse TTL from string or number
   */
  private parseTtl(ttl?: string | number): number {
    if (!ttl) return 3600000; // 1 hour default

    if (typeof ttl === 'number') return ttl * 1000; // Assume seconds

    // Parse duration string (e.g., '1h', '30m', '1d')
    const match = ttl.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 3600000;

    const [, value, unit] = match;
    const num = parseInt(value, 10);

    switch (unit) {
      case 's':
        return num * 1000;
      case 'm':
        return num * 60 * 1000;
      case 'h':
        return num * 60 * 60 * 1000;
      case 'd':
        return num * 24 * 60 * 60 * 1000;
      default:
        return 3600000;
    }
  }

  /**
   * Parse scopes from JWT claim
   */
  private parseScopes(scope: unknown): string[] {
    if (!scope) return [];
    if (Array.isArray(scope)) return scope.map(String);
    if (typeof scope === 'string') return scope.split(/\s+/).filter(Boolean);
    return [];
  }
}
