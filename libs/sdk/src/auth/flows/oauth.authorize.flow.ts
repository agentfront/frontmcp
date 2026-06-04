/**
 * Authorization Endpoint — GET /oauth/authorize
 *
 * Who calls: Browser via the Client (RP).
 *
 * When: Start of the flow.
 *
 * Purpose: Authenticate the user and obtain consent; returns an authorization code to the client's redirect URI.
 *
 * Notes: Must support PKCE. Implicit/Hybrid are out in OAuth 2.1.
 */
/**
 * Typical parameter shapes
 *
 * /oauth/authorize (GET)
 *
 * response_type=code, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method=S256, (optionally request_uri from PAR)
 */
import {
  buildFederatedLoginPage,
  buildIncrementalAuthPage,
  createFederatedAuthSession,
  escapeHtml,
  renderLocalLoginPage,
  startNextProvider,
  type AppAuthCard,
  type AuthProviderDetectionResult,
  type ConsentStateRecord,
  type DetectedAuthProvider,
  type FederatedLoginStateRecord,
  type LoginConfig,
  type ProviderCard,
  type ProviderPkce,
} from '@frontmcp/auth';
import { z, type ZodError } from '@frontmcp/lazy-zod';
import { generateCodeVerifier, randomUUID, sha256Base64url } from '@frontmcp/utils';

import {
  computeResource,
  Flow,
  FlowBase,
  HttpHtmlSchema,
  httpInputSchema,
  HttpRedirectSchema,
  httpRespond,
  HttpTextSchema,
  isOrchestratedMode,
  isRemoteMode,
  resourceUriMatches,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import {
  authUiExtraPath,
  buildAuthUiPage,
  buildFederatedState,
  buildIncrementalState,
  buildLoginState,
  type AuthFlowState,
  type AuthProvider,
  type AuthUiRegistry,
} from '../auth-ui';
import { CimdService, clientMetadataDocumentSchema } from '../cimd';
import { projectConsentTools } from '../consent-tools.helper';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

/**
 * Quick checklist (security & correctness)
 * - PKCE (S256) required for public clients (and basically for all).
 * - Use authorization code grant only (no implicit/hybrid).
 * - Rotate refresh tokens and bind them to client + user + scopes.
 * - Prefer private_key_jwt or mTLS for confidential clients.
 * - PAR + JAR recommended for higher security.
 * - Consider DPoP (proof-of-possession) to reduce token replay.
 * - Keep codes very short-lived (e.g., ≤60 s) and single-use.
 * - Publish discovery and JWKS, rotate keys safely.
 * - Decide JWT vs opaque access tokens; provide introspection if opaque.
 */

// ============================================
// OAuth 2.1 Authorization Request Schemas
// ============================================

/**
 * RFC 7636 PKCE: code_challenge is base64url(sha256(code_verifier))
 * Must be 43-128 characters of A-Za-z0-9-._~
 */
const pkceChallengeSchema = z
  .string()
  .min(43, 'code_challenge must be at least 43 characters')
  .max(128, 'code_challenge must be at most 128 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'code_challenge must contain only A-Za-z0-9-_');

/**
 * OAuth 2.1 requires S256 only (plain is deprecated)
 */
const codeChallengeMethodSchema = z.literal('S256', {
  message: 'code_challenge_method must be "S256" (OAuth 2.1)',
});

/**
 * OAuth 2.1 authorization code flow only
 */
const responseTypeSchema = z.literal('code', {
  message: 'response_type must be "code" (OAuth 2.1)',
});

/**
 * Validate that a URI uses only http or https scheme.
 * Rejects dangerous schemes like javascript:, data:, vbscript:, etc.
 */
const safeRedirectUriSchema = z.url().refine(
  (uri) => {
    try {
      const url = new URL(uri);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'redirect_uri must use http or https scheme' },
);

/**
 * Validated OAuth authorization request for orchestrated mode
 */
const oauthAuthorizeRequestSchema = z.object({
  response_type: responseTypeSchema,
  client_id: z.string().min(1, 'client_id is required'),
  redirect_uri: safeRedirectUriSchema,
  code_challenge: pkceChallengeSchema,
  code_challenge_method: codeChallengeMethodSchema.optional().default('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.string().url().optional(),
});

/**
 * Minimal request for anonymous/default provider mode
 */
const anonymousAuthorizeRequestSchema = z.object({
  redirect_uri: safeRedirectUriSchema,
  state: z.string().optional(),
});

export type OAuthAuthorizeRequest = z.infer<typeof oauthAuthorizeRequestSchema>;
export type AnonymousAuthorizeRequest = z.infer<typeof anonymousAuthorizeRequestSchema>;

// ============================================
// Flow Schemas
// ============================================

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  isDefaultAuthProvider: z.boolean().describe('If FrontMcp initialized without auth options'),
  isOrchestrated: z.boolean().describe('If FrontMcp is orchestrated (local oauth proxy, remote oauth proxy)'),
  allowAnonymous: z.boolean().describe('Allow anonymous access, force orchestrated mode'),
  // Validated OAuth request (after validation)
  validatedRequest: oauthAuthorizeRequestSchema.optional(),
  // Raw parameters for error handling
  rawRedirectUri: z.string().optional(),
  rawState: z.string().optional(),
  // Validation errors
  validationErrors: z.array(z.string()).optional(),
  // Pending authorization ID (for login flow)
  pendingAuthId: z.string().optional(),
  // Progressive/Incremental Authorization
  isIncrementalAuth: z.boolean().default(false).describe('Whether this is an incremental auth request'),
  targetAppId: z.string().optional().describe('Target app ID for incremental authorization'),
  targetToolId: z.string().optional().describe('Target tool ID that triggered the incremental auth'),
  existingSessionId: z.string().optional().describe('Existing session ID for incremental auth'),
  /**
   * Apps the client already holds a grant for (the prior `authorized_apps`
   * claim), carried forward on an incremental authorize so the newly-minted
   * token is the UNION of prior apps + the target app. Only consulted when
   * incremental auth is enabled.
   */
  priorAuthorizedAppIds: z.array(z.string()).optional().describe('Prior authorized app IDs to carry forward'),
  // Federated Login (multi-provider)
  requiresFederatedLogin: z.boolean().default(false).describe('Whether this auth requires federated login UI'),
  // Consent Flow
  requiresConsent: z.boolean().default(false).describe('Whether consent flow is enabled'),
  // CIMD (Client ID Metadata Documents)
  isCimdClient: z.boolean().default(false).describe('Whether client_id is a CIMD URL'),
  cimdMetadata: clientMetadataDocumentSchema.optional().describe('CIMD metadata document for the client'),
});

const outputSchema = z.union([
  HttpRedirectSchema, // for account/login or oauth/callback
  HttpTextSchema,
  HttpHtmlSchema, // for login page
]);

const plan = {
  pre: [
    'parseInput',
    'validateInput',
    'checkIfAuthorized', // used for direct code generation if refresh-token is provided
  ],
  execute: ['prepareAuthorizationRequest', 'buildAuthorizeOutput'],
  post: ['validateOutput'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:authorize': FlowRunOptions<
      OauthAuthorizeFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:authorize' as const;
const Stage = StageHookOf(name);

/**
 * Top-level `auth.providers` declared for local-mode multi-provider
 * orchestration. Only `local` mode carries `providers`; everything else
 * returns an empty list so the app-level federation path is unchanged.
 */
function getConfiguredProviders(auth: unknown): Array<{ id: string; scopes?: string[] }> {
  const providers = (auth as { providers?: unknown } | undefined)?.providers;
  if (!Array.isArray(providers)) {
    return [];
  }
  return providers.filter(
    (p): p is { id: string; scopes?: string[] } => !!p && typeof (p as { id?: unknown }).id === 'string',
  );
}

/** Provider ids declared via top-level `auth.providers` (local-mode federation). */
function getConfiguredProviderIds(auth: unknown): string[] {
  return getConfiguredProviders(auth).map((p) => p.id);
}

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/authorize',
  },
})
export default class OauthAuthorizeFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthAuthorizeFlow');

  @Stage('parseInput')
  async parseInput() {
    const { metadata } = this.scope;
    const { request } = this.rawInput;

    // Store raw params for error handling (redirect_uri and state needed for error responses)
    const rawRedirectUri = request.query['redirect_uri'] as string | undefined;
    const rawState = request.query['state'] as string | undefined;

    // Progressive/Incremental Authorization Parameters
    const targetAppId = request.query['app'] as string | undefined;
    const targetToolId = request.query['tool'] as string | undefined;
    const existingSessionId = request.query['session_id'] as string | undefined;
    const mode = request.query['mode'] as string | undefined;
    const isIncrementalAuth = mode === 'incremental' || !!targetAppId;

    // Apps the client already holds a grant for. The client carries its current
    // `authorized_apps` claim forward via `apps=` (comma-separated or repeated)
    // so an incremental authorize expands rather than replaces the grant.
    const appsParam = request.query['apps'];
    let priorAuthorizedAppIds: string[] | undefined;
    if (appsParam) {
      const raw = Array.isArray(appsParam) ? appsParam : [appsParam];
      const ids = raw
        .flatMap((v) => String(v).split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      priorAuthorizedAppIds = ids.length > 0 ? Array.from(new Set(ids)) : undefined;
    }

    const isDefaultAuthProvider = !metadata.auth;

    // Check if orchestrated mode requires federated login. Two triggers:
    // 1. Top-level `auth.providers` declared (local-mode multi-provider
    //    orchestration — GitHub/Slack/Jira as a turnkey local default).
    // 2. Apps with their own auth providers (app-level federation).
    let requiresFederatedLogin = false;
    if (metadata.auth && isOrchestratedMode(metadata.auth)) {
      const configProviders = getConfiguredProviderIds(metadata.auth);
      // Check if scope has apps with different auth providers
      const apps = this.scope.apps.getApps();
      const appsWithAuth = apps.filter((app) => app.metadata.auth);
      requiresFederatedLogin = configProviders.length > 0 || appsWithAuth.length > 0;
    }

    // Check if consent flow is enabled
    let requiresConsent = false;
    if (metadata.auth && isOrchestratedMode(metadata.auth)) {
      const consentConfig = metadata.auth.consent;
      requiresConsent = consentConfig?.enabled === true;
    }

    this.state.set({
      isOrchestrated: true,
      allowAnonymous: isDefaultAuthProvider,
      isDefaultAuthProvider,
      rawRedirectUri,
      rawState,
      // Progressive/Incremental Authorization
      isIncrementalAuth,
      targetAppId,
      targetToolId,
      existingSessionId,
      priorAuthorizedAppIds,
      // Federated Login
      requiresFederatedLogin,
      // Consent Flow
      requiresConsent,
    });

    if (isIncrementalAuth) {
      this.logger.info(`Incremental authorization requested for app: ${targetAppId}, tool: ${targetToolId}`);
    }

    if (requiresFederatedLogin) {
      this.logger.info(`Federated login required: Multiple auth providers detected`);
    }

    if (requiresConsent) {
      this.logger.info(`Consent flow enabled: User will select tools to expose`);
    }
  }

  @Stage('validateInput')
  async validateInput() {
    const { isDefaultAuthProvider, rawRedirectUri, rawState } = this.state;
    const { request } = this.rawInput;

    // Handle default anonymous provider - minimal validation
    if (isDefaultAuthProvider) {
      const result = anonymousAuthorizeRequestSchema.safeParse({
        redirect_uri: rawRedirectUri,
        state: rawState,
      });

      if (!result.success) {
        const errors = this.formatZodErrors(result.error);
        this.logger.warn(`Anonymous authorization request validation failed: ${errors.join(', ')}`);
        this.respond(httpRespond.html(this.renderErrorPage('invalid_request', errors.join('; ')), 400));
        return;
      }

      // Redirect with anonymous code
      const url = new URL(result.data.redirect_uri);
      url.searchParams.set('code', 'anonymous');
      if (result.data.state) {
        url.searchParams.set('state', result.data.state);
      }
      this.respond(httpRespond.redirect(url.toString()));
      return;
    }

    // Orchestrated mode - full OAuth 2.1 validation
    const result = oauthAuthorizeRequestSchema.safeParse({
      response_type: request.query['response_type'],
      client_id: request.query['client_id'],
      redirect_uri: rawRedirectUri,
      code_challenge: request.query['code_challenge'],
      code_challenge_method: request.query['code_challenge_method'] ?? 'S256',
      scope: request.query['scope'],
      state: rawState,
      resource: request.query['resource'],
    });

    if (!result.success) {
      const errors = this.formatZodErrors(result.error);
      this.logger.warn(`Authorization request validation failed: ${errors.join(', ')}`);
      this.respondWithError(errors, rawRedirectUri, rawState);
      return;
    }

    // Store validated request
    this.state.set('validatedRequest', result.data);

    // Validate resource parameter against server's canonical URI (RFC 8707)
    if (result.data.resource) {
      const canonicalResource = computeResource(request, this.scope.entryPath, this.scope.routeBase);
      if (!resourceUriMatches(result.data.resource, canonicalResource)) {
        this.logger.warn(
          `OAuth authorize: resource mismatch. Provided: ${result.data.resource}, canonical: ${canonicalResource}`,
        );
        this.respondWithError(
          ['Invalid resource parameter: does not match server resource URI'],
          rawRedirectUri,
          rawState,
        );
        return;
      }
    }

    // CIMD validation: Check if client_id is a CIMD URL
    const { client_id, redirect_uri } = result.data;
    const cimdService = this.get(CimdService);

    // Local-AS DCR allowlist enforcement (#462). When `auth.dcr` declares a
    // redirect_uri and/or client_id allowlist, reject requests that fall
    // outside it BEFORE a pending authorization is created. CIMD client ids
    // (URLs) are validated by the CIMD layer below and are exempt from the
    // client_id allowlist, but the redirect_uri allowlist still applies to
    // everyone as defense in depth. No-op when no allowlist is configured, so
    // the default behavior is unchanged.
    const isCimdClientId = !!cimdService?.enabled && cimdService.isCimdClientId(client_id);
    const dcrError = this.checkDcrAllowlist(client_id, redirect_uri, isCimdClientId);
    if (dcrError) {
      this.logger.warn(`OAuth authorize: DCR allowlist rejection — ${dcrError}`);
      // Do NOT redirect an unlisted redirect_uri (open-redirect guard): show an
      // error page when the redirect_uri itself is the problem, otherwise it is
      // safe to redirect the (allowed) redirect_uri with an OAuth error.
      this.respondWithError([dcrError], dcrError.includes('redirect_uri') ? undefined : redirect_uri, rawState);
      return;
    }

    if (cimdService?.enabled && cimdService.isCimdClientId(client_id)) {
      try {
        this.logger.debug(`Processing CIMD client_id: ${client_id}`);
        const resolution = await cimdService.resolveClientMetadata(client_id);

        if (resolution.isCimdClient && resolution.metadata) {
          // Validate redirect_uri against CIMD document
          cimdService.validateRedirectUri(redirect_uri, resolution.metadata);

          // Store CIMD metadata for later use (e.g., consent page client_name)
          this.state.set('isCimdClient', true);
          this.state.set('cimdMetadata', resolution.metadata);

          this.logger.info(
            `CIMD client validated: ${resolution.metadata.client_name} (${client_id})`,
            resolution.fromCache ? ' [from cache]' : '',
          );
        }
      } catch (error) {
        // CIMD validation failed - respond with error
        // Per OAuth 2.1 spec, do NOT redirect to unvalidated redirect_uri - show error page instead
        // This prevents open-redirect attacks when CIMD validation fails
        const errorMessage = error instanceof Error ? error.message : 'CIMD validation failed';
        this.logger.warn(`CIMD validation failed for ${client_id}: ${errorMessage}`);
        this.respondWithError([errorMessage], undefined, rawState);
        return;
      }
    }
  }

  @Stage('checkIfAuthorized')
  async checkIfAuthorized() {
    // TODO: Check if user is already authorized (has valid session cookie)
    // If yes, skip login and directly generate authorization code
    // For now, always proceed to login
  }

  @Stage('prepareAuthorizationRequest')
  async prepareAuthorizationRequest() {
    const {
      validatedRequest,
      isIncrementalAuth,
      targetAppId,
      targetToolId,
      existingSessionId,
      priorAuthorizedAppIds,
      requiresFederatedLogin,
      requiresConsent,
    } = this.state;
    const { metadata } = this.scope;

    if (!validatedRequest) {
      // Should not reach here if validation passed
      return;
    }

    // Store pending authorization request
    const auth = this.scope.auth;
    if (!auth || !('authorizationStore' in auth)) {
      this.respond(httpRespond.html(this.renderErrorPage('server_error', 'Authorization not configured'), 500));
      return;
    }
    const localAuth = auth as LocalPrimaryAuth;
    const store = localAuth.authorizationStore;

    // Build federated login state if multiple providers
    let federatedLogin: FederatedLoginStateRecord | undefined;
    if (requiresFederatedLogin) {
      // Build provider IDs from apps with auth
      const apps = this.scope.apps.getApps();
      const providerIds: string[] = [];

      // Add top-level configured providers (local-mode multi-provider
      // orchestration — these have real registered provider configs).
      for (const id of getConfiguredProviderIds(metadata.auth)) {
        if (!providerIds.includes(id)) {
          providerIds.push(id);
        }
      }

      // Add parent provider only when there are no top-level configured
      // providers (the legacy app-level federation path).
      if (providerIds.length === 0 && metadata.auth && isOrchestratedMode(metadata.auth)) {
        providerIds.push('__parent__');
      }

      // Add app-level providers
      for (const app of apps) {
        if (app.metadata.auth) {
          const appId = app.metadata.id || app.metadata.name;
          if (!providerIds.includes(appId)) {
            providerIds.push(appId);
          }
        }
      }

      federatedLogin = {
        providerIds,
        selectedProviderIds: undefined,
        skippedProviderIds: undefined,
      };
    }

    // Build consent state if enabled
    let consent: ConsentStateRecord | undefined;
    if (requiresConsent) {
      // Derive the offerable tool ids from the scope via the SHARED projection
      // (effective runtime ids, `excludedTools` removed) so the authorize-time
      // available set, the consent screen, and the call-time enforcement all
      // agree on the same identifiers.
      const consentConfig = metadata.auth && isOrchestratedMode(metadata.auth) ? metadata.auth.consent : undefined;
      const { availableToolIds } = projectConsentTools(this.scope, consentConfig?.excludedTools);

      consent = {
        enabled: true,
        availableToolIds,
        selectedToolIds: undefined,
        consentCompleted: false,
      };
    }

    const pendingRecord = store.createPendingRecord({
      clientId: validatedRequest.client_id,
      redirectUri: validatedRequest.redirect_uri,
      scopes: validatedRequest.scope ? validatedRequest.scope.split(' ') : [],
      pkce: {
        challenge: validatedRequest.code_challenge,
        method: 'S256',
      },
      state: validatedRequest.state,
      resource: validatedRequest.resource,
      // Progressive/Incremental Authorization Fields
      isIncremental: isIncrementalAuth,
      targetAppId,
      targetToolId,
      existingSessionId,
      priorAuthorizedAppIds,
      // Federated Login State
      federatedLogin,
      // Consent State
      consent,
    });

    await localAuth.authorizationStore.storePendingAuthorization(pendingRecord);
    this.logger.info(
      `Pending authorization created: ${pendingRecord.id}${
        isIncrementalAuth ? ` (incremental for app: ${targetAppId})` : ''
      }${requiresFederatedLogin ? ' (federated)' : ''}${requiresConsent ? ' (consent enabled)' : ''}`,
    );

    this.state.set('pendingAuthId', pendingRecord.id);
  }

  @Stage('buildAuthorizeOutput')
  async buildAuthorizeOutput() {
    const {
      pendingAuthId,
      validatedRequest,
      isIncrementalAuth,
      targetAppId,
      targetToolId,
      requiresFederatedLogin,
      isCimdClient,
      cimdMetadata,
    } = this.state;

    if (!validatedRequest || !pendingAuthId) {
      return;
    }

    // Remote mode (`mode: 'remote'`): a single MANDATORY upstream provider.
    // Skip BOTH the in-tree login page and the provider-selection page — start
    // the federated session for that one provider and redirect straight to the
    // upstream IdP. Incremental auth still renders its own page (handled below).
    const { metadata } = this.scope;
    if (metadata.auth && isRemoteMode(metadata.auth) && !isIncrementalAuth) {
      await this.startRemoteFederation(pendingAuthId, validatedRequest);
      return;
    }

    // Use CIMD client_name if available, otherwise fall back to client_id
    const clientDisplayName = cimdMetadata?.client_name ?? validatedRequest.client_id;

    // For incremental auth, render a single-app authorization page
    if (isIncrementalAuth && targetAppId) {
      const apps = this.scope.apps.getApps();
      const app = apps.find((a) => a.metadata.id === targetAppId);
      const appName = app?.metadata?.name || targetAppId;
      const appDescription = app?.metadata?.description;

      // Custom `@AuthUi({ slot: 'incremental' })` renderer takes over when registered.
      const customIncremental = await this.tryRenderCustomSlot('incremental', pendingAuthId, (common) =>
        buildIncrementalState(common, {
          appId: targetAppId,
          appName,
          appDescription,
          toolId: targetToolId,
          redirectUri: validatedRequest.redirect_uri,
        }),
      );
      if (customIncremental) return;

      const incrementalAuthHtml = this.renderIncrementalAuthPage({
        pendingAuthId,
        appId: targetAppId,
        appName,
        appDescription,
        toolId: targetToolId,
        redirectUri: validatedRequest.redirect_uri,
      });

      this.respond(httpRespond.html(incrementalAuthHtml));
      return;
    }

    // For federated login (multiple providers), render provider selection page
    if (requiresFederatedLogin) {
      const apps = this.scope.apps.getApps();
      const providers: DetectedAuthProvider[] = [];
      const { metadata } = this.scope;

      // Add top-level configured providers (local-mode multi-provider
      // orchestration). These are real upstream providers the user links.
      const configuredProviders = getConfiguredProviders(metadata.auth);
      const hasConfiguredProviders = configuredProviders.length > 0;
      for (const p of configuredProviders) {
        providers.push({
          id: p.id,
          mode: 'local',
          appIds: [p.id],
          scopes: p.scopes ?? [],
          isParentProvider: false,
        });
      }

      // Add parent provider only on the legacy app-level federation path
      // (no top-level configured providers).
      if (!hasConfiguredProviders && metadata.auth && isOrchestratedMode(metadata.auth)) {
        providers.push({
          id: '__parent__',
          mode: metadata.auth.mode,
          appIds: ['__parent__'],
          scopes: [],
          isParentProvider: true,
        });
      }

      // Add app-level providers
      for (const app of apps) {
        if (app.metadata.auth) {
          const appId = app.metadata.id || app.metadata.name;
          if (!providers.some((p) => p.id === appId)) {
            providers.push({
              id: appId,
              providerUrl: app.metadata.auth.mode === 'transparent' ? app.metadata.auth.provider : undefined,
              mode: app.metadata.auth.mode,
              appIds: [appId],
              scopes: [],
              isParentProvider: false,
            });
          }
        }
      }

      const detection: AuthProviderDetectionResult = {
        providers: new Map(providers.map((p) => [p.id, p])),
        requiresOrchestration: true,
        parentProviderId: hasConfiguredProviders ? undefined : '__parent__',
        childProviderIds: providers.filter((p) => !p.isParentProvider).map((p) => p.id),
        uniqueProviderCount: providers.length,
        validationErrors: [],
        warnings: [],
      };

      // Custom `@AuthUi({ slot: 'federated' })` renderer takes over when registered.
      const customFederated = await this.tryRenderCustomSlot('federated', pendingAuthId, (common) =>
        buildFederatedState(common, {
          clientId: validatedRequest.client_id,
          clientName: clientDisplayName,
          redirectUri: validatedRequest.redirect_uri,
          providers: [...detection.providers.values()].map(
            (p): AuthProvider => ({
              id: p.id,
              name: p.id,
              url: p.providerUrl,
              mode: p.mode,
              appIds: p.appIds.filter((id) => id !== '__parent__'),
              primary: p.isParentProvider,
            }),
          ),
        }),
      );
      if (customFederated) return;

      const federatedLoginHtml = this.renderFederatedLoginPage({
        pendingAuthId,
        detection,
        clientId: validatedRequest.client_id,
        redirectUri: validatedRequest.redirect_uri,
      });

      this.respond(httpRespond.html(federatedLoginHtml));
      return;
    }

    // Custom `@AuthUi({ slot: 'login' })` renderer takes over when registered.
    const customLogin = await this.tryRenderCustomSlot('login', pendingAuthId, (common) =>
      buildLoginState(common, {
        clientId: validatedRequest.client_id,
        clientName: clientDisplayName,
        scopes: validatedRequest.scope ? validatedRequest.scope.split(' ').filter(Boolean) : [],
        redirectUri: validatedRequest.redirect_uri,
        logoUri: cimdMetadata?.logo_uri,
      }),
    );
    if (customLogin) return;

    // Render a simple login page for full authorization
    // In production, this would redirect to a proper login UI
    const loginHtml = this.renderLoginPage({
      pendingAuthId,
      clientId: validatedRequest.client_id,
      clientName: clientDisplayName, // Use CIMD client_name if available
      scope: validatedRequest.scope ?? '',
      redirectUri: validatedRequest.redirect_uri,
      logoUri: cimdMetadata?.logo_uri, // Use CIMD logo_uri if available
    });

    this.respond(httpRespond.html(loginHtml));
  }

  /**
   * Render a custom `@AuthUi` slot when one is registered for this scope.
   *
   * Mints the per-pending-auth CSRF token (server-owned), persists it onto the
   * pending authorization record (so the callback can verify it across nodes),
   * builds the {@link AuthFlowState} via `buildState`, SSRs the registered
   * component, and responds with the assembled page + CSP / anti-clickjacking
   * headers. Returns `true` when it handled the slot (caller should `return`),
   * `false` to fall through to the built-in page (no renderer / build failed).
   */
  private async tryRenderCustomSlot(
    slot: 'login' | 'consent' | 'incremental' | 'federated' | 'error',
    pendingAuthId: string,
    buildState: (common: {
      pendingAuthId: string;
      submitUrl: string;
      extraUrl: string;
      csrfToken: string;
      addedItems?: Record<string, unknown[]>;
    }) => AuthFlowState,
  ): Promise<boolean> {
    const authUi: AuthUiRegistry | undefined = this.scope.authUi;
    if (!authUi || !authUi.hasSlot(slot)) return false;

    const csrfToken = authUi.mintCsrf(pendingAuthId);

    // Persist the CSRF token on the pending record so the callback can verify it
    // even if the in-memory registry map is on a different node.
    try {
      const localAuth = this.scope.auth as LocalPrimaryAuth;
      const record = await localAuth.authorizationStore.getPendingAuthorization(pendingAuthId);
      if (record) {
        record.authUiCsrf = csrfToken;
        await localAuth.authorizationStore.storePendingAuthorization(record);
      }
    } catch (err) {
      this.logger.warn(`Failed to persist auth-UI CSRF on pending record: ${err instanceof Error ? err.message : err}`);
    }

    const state = buildState({
      pendingAuthId,
      submitUrl: `${this.scope.fullPath}/oauth/callback`,
      extraUrl: authUiExtraPath(this.scope.fullPath),
      csrfToken,
      addedItems: authUi.getAddedItems(pendingAuthId),
    });

    const page = buildAuthUiPage({ registry: authUi, slot, state, fullPath: this.scope.fullPath });
    if (!page) return false; // build failed → fall back to the built-in page

    this.respond(httpRespond.html(page.html, 200, page.headers));
    return true;
  }

  /**
   * Remote mode (`mode: 'remote'`) auto-federation.
   *
   * Builds a federated auth session for the SINGLE mandatory upstream provider
   * registered by {@link LocalPrimaryAuth.registerRemoteProvider}, starts it
   * (fresh PKCE + state), persists the session, and redirects straight to the
   * upstream IdP's authorization endpoint. This reuses the exact federated
   * machinery the multi-provider local path uses (`/oauth/provider/:id/callback`
   * then completes the exchange, stores upstream tokens, and mints the FrontMCP
   * session token whose identity comes from the upstream user) — but skips the
   * in-tree login page and the provider-selection page entirely.
   *
   * No identity is collected in-tree: the federated session is created with an
   * EMPTY `userInfo` so the minted token's `sub`/`email`/`name` derive solely
   * from the upstream provider (see the provider-callback flow).
   */
  private async startRemoteFederation(pendingAuthId: string, validatedRequest: OAuthAuthorizeRequest): Promise<void> {
    const auth = this.scope.auth;
    if (!auth || !('federatedSessionStore' in auth)) {
      this.respond(httpRespond.html(this.renderErrorPage('server_error', 'Authorization not configured'), 500));
      return;
    }
    const localAuth = auth as LocalPrimaryAuth;
    const providerId = localAuth.remoteProviderId;

    // No upstream provider registered (e.g. missing clientId / DCR not wired).
    if (!providerId || !localAuth.getProviderConfig(providerId)) {
      this.logger.error('Remote mode: no upstream provider configured for federation');
      // Drop the pending authorization stored just before this call so it does
      // not linger until TTL expiry after we abort the flow.
      await localAuth.authorizationStore.deletePendingAuthorization(pendingAuthId);
      this.respond(
        httpRespond.html(this.renderErrorPage('server_error', 'Upstream identity provider is not configured'), 500),
      );
      return;
    }

    // Build a federated session for the single provider. Identity is left empty
    // on purpose — it is filled from the upstream IdP in the provider callback.
    const session = createFederatedAuthSession({
      pendingAuthId,
      clientId: validatedRequest.client_id,
      redirectUri: validatedRequest.redirect_uri,
      scopes: validatedRequest.scope ? validatedRequest.scope.split(' ').filter(Boolean) : [],
      state: validatedRequest.state,
      resource: validatedRequest.resource,
      userInfo: {},
      frontmcpPkce: { challenge: validatedRequest.code_challenge, method: 'S256' },
      providerIds: [providerId],
    });

    // Fresh PKCE + state for the upstream authorization-code exchange.
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);
    const pkce: ProviderPkce = { verifier, challenge, method: 'S256' };
    const providerState = `federated:${session.id}:${randomUUID()}`;
    startNextProvider(session, pkce, providerState);

    await localAuth.federatedSessionStore.store(session);

    const redirectUrl = await localAuth.buildProviderAuthorizeUrl(providerId, {
      state: providerState,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    });

    if (!redirectUrl) {
      this.logger.error(`Remote mode: failed to build authorize URL for provider: ${providerId}`);
      // The federated session was created above; tear it down AND drop the
      // pending authorization so neither lingers until TTL expiry.
      await localAuth.federatedSessionStore.delete(session.id);
      await localAuth.authorizationStore.deletePendingAuthorization(pendingAuthId);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', `Failed to initiate authentication with provider: ${providerId}`),
          500,
        ),
      );
      return;
    }

    this.logger.info(`Remote mode: redirecting to upstream provider: ${providerId}`);
    this.respond(httpRespond.redirect(redirectUrl));
  }

  @Stage('validateOutput')
  async validateOutput() {
    // Output validation is handled by schema
  }

  /**
   * Enforce the local-AS DCR allowlists (#462) at authorize time. Returns a
   * human-readable rejection reason, or `undefined` when the request is allowed
   * (including when no allowlist is configured, or the auth instance does not
   * expose a DCR registry — e.g. non-local modes).
   *
   * - `allowedRedirectUris`: applies to ALL clients (CIMD or not) as an
   *   open-redirect / lateral-movement guard.
   * - `allowedClientIds`: applies only to non-CIMD client ids; CIMD URLs are
   *   validated by the CIMD layer instead.
   */
  private checkDcrAllowlist(clientId: string, redirectUri: string, isCimdClientId: boolean): string | undefined {
    const auth = this.scope.auth as Partial<LocalPrimaryAuth> | undefined;
    const registry = auth?.dcrClientRegistry;
    if (!registry) {
      return undefined;
    }

    if (registry.hasRedirectAllowlist() && !registry.isRedirectUriAllowed(redirectUri)) {
      return `redirect_uri "${redirectUri}" is not in the configured allowlist`;
    }

    if (!isCimdClientId && registry.hasClientIdAllowlist() && !registry.isClientIdAllowed(clientId)) {
      return `client_id "${clientId}" is not in the configured allowlist`;
    }

    return undefined;
  }

  /**
   * Format Zod errors into human-readable strings
   */
  private formatZodErrors(error: ZodError): string[] {
    return error.issues.map((err) => {
      const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
      return `${path}${err.message}`;
    });
  }

  /**
   * Respond with OAuth error - redirect if possible, otherwise show error page
   */
  private respondWithError(errors: string[], redirectUri?: string, state?: string): void {
    const errorDescription = errors.join('; ');

    // Try to redirect with error if we have a valid and safe redirect_uri
    // Must validate against safeRedirectUriSchema to prevent open-redirect/XSS on error paths
    if (redirectUri) {
      const safe = safeRedirectUriSchema.safeParse(redirectUri);
      if (safe.success) {
        const url = new URL(safe.data);
        url.searchParams.set('error', 'invalid_request');
        url.searchParams.set('error_description', errorDescription);
        if (state) {
          url.searchParams.set('state', state);
        }
        this.respond(httpRespond.redirect(url.toString()));
        return;
      }
      // Unsafe redirect_uri (javascript:, data:, etc.), fall through to error page
    }

    this.respond(httpRespond.html(this.renderErrorPage('invalid_request', errorDescription), 400));
  }

  /**
   * Render the local login page.
   *
   * Honors `auth.login` (Checkpoint 3a): a `login.render` override yields full
   * custom HTML, `login.fields` extends the built-in form, and otherwise the
   * unchanged default email/name page is rendered. Rendering is delegated to
   * the shared `renderLocalLoginPage` helper so the authorize flow and the
   * callback error re-render stay in sync.
   */
  private renderLoginPage(params: {
    pendingAuthId: string;
    clientId: string;
    clientName?: string;
    scope: string;
    redirectUri: string;
    logoUri?: string;
  }): string {
    const { pendingAuthId, clientId, clientName, scope, logoUri } = params;
    const callbackPath = `${this.scope.fullPath}/oauth/callback`;

    // Read the optional login customization from the local auth options.
    // Only local mode carries `login`; any other mode leaves it undefined,
    // preserving the default page exactly.
    const auth = this.scope.metadata.auth;
    const login: LoginConfig | undefined =
      auth && auth.mode === 'local' ? (auth as { login?: LoginConfig }).login : undefined;

    const ctx = {
      clientId,
      clientName: clientName ?? clientId,
      logoUri,
      scopes: scope ? scope.split(' ').filter(Boolean) : [],
      pendingAuthId,
      callbackPath,
      fields: login?.fields ?? {},
    };

    return renderLocalLoginPage(login, ctx);
  }

  /**
   * Render incremental authorization page for a single app using HTMX templates
   */
  private renderIncrementalAuthPage(params: {
    pendingAuthId: string;
    appId: string;
    appName: string;
    appDescription?: string;
    toolId?: string;
    redirectUri: string;
  }): string {
    const { pendingAuthId, appId, appName, appDescription, toolId } = params;
    const callbackPath = `${this.scope.fullPath}/oauth/callback`;

    const app: AppAuthCard = {
      appId,
      appName,
      description: appDescription,
    };

    return buildIncrementalAuthPage({
      app,
      toolId: toolId || 'unknown tool',
      sessionHint: pendingAuthId,
      callbackPath,
    });
  }

  /**
   * Render federated login page for multiple auth providers using HTMX templates
   */
  private renderFederatedLoginPage(params: {
    pendingAuthId: string;
    detection: AuthProviderDetectionResult;
    clientId: string;
    redirectUri: string;
  }): string {
    const { pendingAuthId, detection, clientId } = params;
    const callbackPath = `${this.scope.fullPath}/oauth/callback`;

    // Convert detection providers to ProviderCard format
    const providers: ProviderCard[] = [...detection.providers.values()].map((provider) => ({
      providerId: provider.id,
      providerName: provider.id,
      providerUrl: provider.providerUrl,
      mode: provider.mode,
      appIds: provider.appIds.filter((id) => id !== '__parent__'),
      isPrimary: provider.isParentProvider,
    }));

    return buildFederatedLoginPage({
      providers,
      clientName: clientId,
      pendingAuthId,
      callbackPath,
    });
  }

  /**
   * Render an error page
   */
  private renderErrorPage(error: string, description: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 500px;
      text-align: center;
    }
    .error-icon { font-size: 48px; margin-bottom: 20px; }
    h1 { color: #e53e3e; margin-bottom: 10px; }
    p { color: #666; line-height: 1.6; }
    .error-code { font-family: monospace; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>Authorization Error</h1>
    <p><span class="error-code">${escapeHtml(error)}</span></p>
    <p>${escapeHtml(description)}</p>
  </div>
</body>
</html>`;
  }
}
