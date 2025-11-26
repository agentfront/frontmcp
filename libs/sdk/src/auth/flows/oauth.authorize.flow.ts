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
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpRedirectSchema,
  httpRespond,
  HttpHtmlSchema,
  HttpTextSchema,
  StageHookOf,
  isOrchestratedMode,
} from '../../common';
import { z, ZodError } from 'zod';
import { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';
import {
  InMemoryAuthorizationStore,
  FederatedLoginStateRecord,
  ConsentStateRecord,
} from '../session/authorization.store';
import { AuthProviderDetectionResult, DetectedAuthProvider } from '../detection';
import {
  buildLoginPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildErrorPage,
  escapeHtml,
  type AppAuthCard,
  type ProviderCard,
} from '../ui';

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
  errorMap: () => ({ message: 'code_challenge_method must be "S256" (OAuth 2.1)' }),
});

/**
 * OAuth 2.1 authorization code flow only
 */
const responseTypeSchema = z.literal('code', {
  errorMap: () => ({ message: 'response_type must be "code" (OAuth 2.1)' }),
});

/**
 * Validated OAuth authorization request for orchestrated mode
 */
const oauthAuthorizeRequestSchema = z.object({
  response_type: responseTypeSchema,
  client_id: z.string().min(1, 'client_id is required'),
  redirect_uri: z.string().url('redirect_uri must be a valid URL'),
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
  redirect_uri: z.string().url('redirect_uri is required'),
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
  // Federated Login (multi-provider)
  requiresFederatedLogin: z.boolean().default(false).describe('Whether this auth requires federated login UI'),
  // Consent Flow
  requiresConsent: z.boolean().default(false).describe('Whether consent flow is enabled'),
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

    const isDefaultAuthProvider = !metadata.auth;

    // Check if orchestrated mode with multiple providers (requires federated login)
    // This is determined by checking if there are multiple apps with different auth providers
    let requiresFederatedLogin = false;
    if (metadata.auth && isOrchestratedMode(metadata.auth)) {
      // Check if scope has apps with different auth providers
      const apps = this.scope.apps.getApps();
      const appsWithAuth = apps.filter((app) => app.metadata.auth);
      requiresFederatedLogin = appsWithAuth.length > 0;
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
    const store = localAuth.authorizationStore as InMemoryAuthorizationStore;

    // Build federated login state if multiple providers
    let federatedLogin: FederatedLoginStateRecord | undefined;
    if (requiresFederatedLogin) {
      // Build provider IDs from apps with auth
      const apps = this.scope.apps.getApps();
      const providerIds: string[] = [];

      // Add parent provider
      if (metadata.auth && isOrchestratedMode(metadata.auth)) {
        providerIds.push('__parent__');
      }

      // Add app-level providers
      for (const app of apps) {
        if (app.metadata.auth) {
          providerIds.push(app.metadata.id || app.metadata.name);
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
      // Get all available tools from the scope
      const tools = this.scope.tools.getTools();
      const availableToolIds = tools.map((t) => t.metadata.id).filter((id): id is string => id !== undefined);

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
    const { pendingAuthId, validatedRequest, isIncrementalAuth, targetAppId, targetToolId, requiresFederatedLogin } =
      this.state;

    if (!validatedRequest || !pendingAuthId) {
      return;
    }

    // For incremental auth, render a single-app authorization page
    if (isIncrementalAuth && targetAppId) {
      const apps = this.scope.apps.getApps();
      const app = apps.find((a) => a.metadata.id === targetAppId);
      const appName = app?.metadata?.name || targetAppId;
      const appDescription = app?.metadata?.description;

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

      // Add parent provider
      const { metadata } = this.scope;
      if (metadata.auth && isOrchestratedMode(metadata.auth)) {
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
          providers.push({
            id: app.metadata.id || app.metadata.name,
            providerUrl: app.metadata.auth.mode === 'transparent' ? app.metadata.auth.remote.provider : undefined,
            mode: app.metadata.auth.mode,
            appIds: [app.metadata.id || app.metadata.name],
            scopes: [],
            isParentProvider: false,
          });
        }
      }

      const detection: AuthProviderDetectionResult = {
        providers: new Map(providers.map((p) => [p.id, p])),
        requiresOrchestration: true,
        parentProviderId: '__parent__',
        childProviderIds: providers.filter((p) => !p.isParentProvider).map((p) => p.id),
        uniqueProviderCount: providers.length,
        validationErrors: [],
        warnings: [],
      };

      const federatedLoginHtml = this.renderFederatedLoginPage({
        pendingAuthId,
        detection,
        clientId: validatedRequest.client_id,
        redirectUri: validatedRequest.redirect_uri,
      });

      this.respond(httpRespond.html(federatedLoginHtml));
      return;
    }

    // Render a simple login page for full authorization
    // In production, this would redirect to a proper login UI
    const loginHtml = this.renderLoginPage({
      pendingAuthId,
      clientId: validatedRequest.client_id,
      scope: validatedRequest.scope ?? '',
      redirectUri: validatedRequest.redirect_uri,
    });

    this.respond(httpRespond.html(loginHtml));
  }

  @Stage('validateOutput')
  async validateOutput() {
    // Output validation is handled by schema
  }

  /**
   * Format Zod errors into human-readable strings
   */
  private formatZodErrors(error: ZodError): string[] {
    return error.errors.map((err) => {
      const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
      return `${path}${err.message}`;
    });
  }

  /**
   * Respond with OAuth error - redirect if possible, otherwise show error page
   */
  private respondWithError(errors: string[], redirectUri?: string, state?: string): void {
    const errorDescription = errors.join('; ');

    // Try to redirect with error if we have a valid redirect_uri
    if (redirectUri) {
      try {
        const url = new URL(redirectUri);
        url.searchParams.set('error', 'invalid_request');
        url.searchParams.set('error_description', errorDescription);
        if (state) {
          url.searchParams.set('state', state);
        }
        this.respond(httpRespond.redirect(url.toString()));
        return;
      } catch {
        // Invalid redirect_uri, fall through to error page
      }
    }

    this.respond(httpRespond.html(this.renderErrorPage('invalid_request', errorDescription), 400));
  }

  /**
   * Render a simple login page using HTMX templates
   */
  private renderLoginPage(params: {
    pendingAuthId: string;
    clientId: string;
    scope: string;
    redirectUri: string;
  }): string {
    const { pendingAuthId, clientId, scope } = params;
    const callbackPath = `${this.scope.fullPath}/oauth/callback`;

    return buildLoginPage({
      clientName: clientId,
      scope,
      pendingAuthId,
      callbackPath,
    });
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
      csrfToken: '', // No CSRF needed for GET form
      callbackPath,
    });
  }

  /**
   * Render consent page for tool selection
   * This is a placeholder - in production, use Juris/Svelte for the UI
   */
  private renderConsentPage(params: {
    pendingAuthId: string;
    tools: Array<{ id: string; name: string; description?: string; appId: string; appName: string }>;
    userEmail?: string;
    userName?: string;
  }): string {
    const { pendingAuthId, tools, userEmail, userName } = params;
    const callbackPath = `${this.scope.fullPath}/oauth/consent`;

    // Group tools by app
    const toolsByApp = tools.reduce((acc, tool) => {
      if (!acc[tool.appId]) {
        acc[tool.appId] = { appName: tool.appName, tools: [] };
      }
      acc[tool.appId].tools.push(tool);
      return acc;
    }, {} as Record<string, { appName: string; tools: typeof tools }>);

    // Build tool cards HTML grouped by app
    const appGroupsHtml = Object.entries(toolsByApp)
      .map(([appId, { appName, tools: appTools }]) => {
        const toolCardsHtml = appTools
          .map(
            (tool) => `
        <label class="tool-card">
          <input type="checkbox" name="tools" value="${escapeHtml(tool.id)}" checked>
          <div class="tool-content">
            <div class="tool-name">${escapeHtml(tool.name)}</div>
            ${tool.description ? `<div class="tool-description">${escapeHtml(tool.description)}</div>` : ''}
          </div>
        </label>
      `,
          )
          .join('');

        return `
        <div class="app-group">
          <div class="app-group-header">
            <span class="app-group-icon">${escapeHtml(appName.charAt(0).toUpperCase())}</span>
            <span class="app-group-name">${escapeHtml(appName)}</span>
            <button type="button" class="toggle-app" data-app-id="${escapeHtml(
              appId,
            )}" onclick="toggleAppTools(this.dataset.appId)">Toggle All</button>
          </div>
          <div class="app-tools" data-app="${escapeHtml(appId)}">
            ${toolCardsHtml}
          </div>
        </div>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select Tools - FrontMCP</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .consent-container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      width: 100%;
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 24px; }
    .subtitle { color: #666; margin-bottom: 20px; font-size: 14px; line-height: 1.5; }
    .user-info {
      background: #f8f9fa;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .user-info strong { color: #333; }
    .select-controls {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      align-items: center;
    }
    .select-controls label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: #666;
      cursor: pointer;
    }
    .app-group {
      background: #f8f9fa;
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .app-group-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: #e9ecef;
    }
    .app-group-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
    }
    .app-group-name { font-weight: 600; color: #333; flex: 1; }
    .toggle-app {
      padding: 6px 12px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .toggle-app:hover { background: #f0f0f0; }
    .app-tools { padding: 12px; }
    .tool-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      background: white;
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tool-card:hover { background: #f0f4ff; }
    .tool-card:last-child { margin-bottom: 0; }
    .tool-card input { margin-top: 2px; }
    .tool-content { flex: 1; }
    .tool-name { font-weight: 500; color: #333; font-size: 14px; }
    .tool-description { font-size: 12px; color: #666; margin-top: 4px; }
    .button-group { display: flex; gap: 12px; margin-top: 24px; }
    button {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn-confirm {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-confirm:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
    .btn-cancel {
      background: #e5e7eb;
      color: #374151;
    }
    .btn-cancel:hover { background: #d1d5db; }
    .selection-summary {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 16px;
      font-size: 13px;
      color: #0369a1;
    }
  </style>
</head>
<body>
  <div class="consent-container">
    <h1>Select Tools to Enable</h1>
    <p class="subtitle">
      Choose which tools you want to make available to the AI assistant.
      You can enable or disable tools at any time.
    </p>

    ${
      userEmail || userName
        ? `
    <div class="user-info">
      Logged in as: <strong>${escapeHtml(userName || userEmail || '')}</strong>
    </div>
    `
        : ''
    }

    <form action="${escapeHtml(callbackPath)}" method="POST" id="consent-form">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">

      <div class="select-controls">
        <label>
          <input type="checkbox" id="select-all" onchange="toggleAllTools(this)" checked>
          Select all tools
        </label>
        <span style="color: #999; font-size: 12px;" id="selection-count">${tools.length} of ${
      tools.length
    } selected</span>
      </div>

      ${appGroupsHtml}

      <div class="selection-summary" id="selection-summary">
        Selected tools will be available to the AI assistant.
      </div>

      <div class="button-group">
        <button type="button" class="btn-cancel" onclick="history.back()">Cancel</button>
        <button type="submit" class="btn-confirm">Confirm Selection</button>
      </div>
    </form>
  </div>

  <script>
    function toggleAllTools(checkbox) {
      const checkboxes = document.querySelectorAll('input[name="tools"]');
      checkboxes.forEach(cb => cb.checked = checkbox.checked);
      updateCount();
    }

    function toggleAppTools(appId) {
      const container = document.querySelector(\`.app-tools[data-app="\${appId}"]\`);
      const checkboxes = container.querySelectorAll('input[name="tools"]');
      const allChecked = [...checkboxes].every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      updateSelectAll();
      updateCount();
    }

    function updateSelectAll() {
      const all = document.querySelectorAll('input[name="tools"]');
      const checked = document.querySelectorAll('input[name="tools"]:checked');
      document.getElementById('select-all').checked = all.length === checked.length;
    }

    function updateCount() {
      const all = document.querySelectorAll('input[name="tools"]');
      const checked = document.querySelectorAll('input[name="tools"]:checked');
      document.getElementById('selection-count').textContent = \`\${checked.length} of \${all.length} selected\`;
    }

    // Add change listeners to all tool checkboxes
    document.querySelectorAll('input[name="tools"]').forEach(cb => {
      cb.addEventListener('change', () => {
        updateSelectAll();
        updateCount();
      });
    });
  </script>
</body>
</html>`;
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
