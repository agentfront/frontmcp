/**
 * OAuth Callback Endpoint — GET /oauth/callback
 *
 * Who calls: Browser after user completes login form
 *
 * When: After the user submits the login form from /oauth/authorize
 *
 * Purpose: Creates an authorization code and redirects back to the client's redirect_uri
 *
 * Notes: This is a simple "demo" login callback. In production, this would integrate
 * with a real identity provider or user database.
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
  StageHookOf,
} from '../../common';
import { z } from 'zod';
import { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';
import { randomUUID, createHash } from 'crypto';
import { escapeHtml } from '../ui';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  // From query params
  pendingAuthId: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  // From pending authorization record
  clientId: z.string().optional(),
  redirectUri: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  codeChallenge: z.string().optional(),
  originalState: z.string().optional(),
  resource: z.string().optional(),
  // Generated
  authorizationCode: z.string().optional(),
  userSub: z.string().optional(),
  // Progressive/Incremental Authorization
  isIncremental: z.boolean().default(false),
  targetAppId: z.string().optional(),
  targetToolId: z.string().optional(),
  existingSessionId: z.string().optional(),
  existingAuthorizationId: z.string().optional(),
  // Federated Login
  isFederated: z.boolean().default(false),
  selectedProviders: z.array(z.string()).optional(),
  skippedProviders: z.array(z.string()).optional(),
  // Consent
  consentEnabled: z.boolean().default(false),
  selectedTools: z.array(z.string()).optional(),
});

const outputSchema = z.union([HttpRedirectSchema, HttpHtmlSchema]);

const plan = {
  pre: ['parseInput', 'validatePendingAuth'],
  execute: ['handleIncrementalAuth', 'createAuthorizationCode', 'redirectToClient'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:callback': FlowRunOptions<
      OauthCallbackFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:callback' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/callback',
  },
})
export default class OauthCallbackFlow extends FlowBase<typeof name> {
  private logger = this.scope.logger.child('OauthCallbackFlow');

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;

    // Extract login form data from query params
    const pendingAuthId = request.query['pending_auth_id'] as string | undefined;
    const email = request.query['email'] as string | undefined;
    const name = request.query['name'] as string | undefined;

    // Progressive/Incremental Authorization Parameters
    const isIncremental = request.query['incremental'] === 'true';
    const targetAppId = request.query['app_id'] as string | undefined;

    // Federated Login Parameters
    const isFederated = request.query['federated'] === 'true';
    // providers can be array (multiple checkboxes) or string (single)
    const providersParam = request.query['providers'];
    let selectedProviders: string[] | undefined;
    if (providersParam) {
      selectedProviders = Array.isArray(providersParam) ? providersParam : [providersParam];
    }

    // Consent Parameters (from POST body or query)
    // Note: For consent, we might use POST, but GET is also supported
    const toolsParam = request.query['tools'];
    let selectedTools: string[] | undefined;
    if (toolsParam) {
      selectedTools = Array.isArray(toolsParam) ? toolsParam : [toolsParam];
    }

    this.state.set({
      pendingAuthId,
      email,
      name,
      isIncremental,
      targetAppId,
      isFederated,
      selectedProviders,
      selectedTools,
    });

    if (isIncremental) {
      this.logger.info(`Incremental auth callback for app: ${targetAppId}`);
    }

    if (isFederated) {
      this.logger.info(`Federated login callback with ${selectedProviders?.length || 0} selected providers`);
    }

    if (selectedTools && selectedTools.length > 0) {
      this.logger.info(`Consent callback with ${selectedTools.length} selected tools`);
    }
  }

  @Stage('validatePendingAuth')
  async validatePendingAuth() {
    const { pendingAuthId, email, isIncremental, isFederated, selectedProviders, selectedTools } = this.state;

    if (!pendingAuthId) {
      this.logger.warn('Missing pending_auth_id in callback');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Missing pending_auth_id parameter'), 400));
      return;
    }

    // For incremental auth, email is not required (user already authenticated)
    if (!isIncremental && !email) {
      this.logger.warn('Missing email in callback');
      this.respond(httpRespond.html(this.renderErrorPage('invalid_request', 'Email is required'), 400));
      return;
    }

    // Retrieve the pending authorization
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const pendingAuth = await localAuth.authorizationStore.getPendingAuthorization(pendingAuthId);

    if (!pendingAuth) {
      this.logger.warn(`Pending authorization not found or expired: ${pendingAuthId}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('invalid_request', 'Authorization request has expired. Please try again.'),
          400,
        ),
      );
      return;
    }

    // Generate a user sub from email (in production, this would come from a user database)
    // For incremental auth, we might need to use existing session's user sub
    const userSub = email ? this.generateUserSub(email) : undefined;

    // Calculate skipped providers from federated login
    let skippedProviders: string[] | undefined;
    if (isFederated && pendingAuth.federatedLogin) {
      const allProviders = pendingAuth.federatedLogin.providerIds;
      const selected = selectedProviders || [];
      skippedProviders = allProviders.filter((id) => !selected.includes(id));
    }

    // Get consent state
    const consentEnabled = pendingAuth.consent?.enabled ?? false;
    // If consent was enabled and user submitted selection, use it; otherwise use all available
    const finalSelectedTools = consentEnabled && selectedTools ? selectedTools : pendingAuth.consent?.availableToolIds;

    this.state.set({
      clientId: pendingAuth.clientId,
      redirectUri: pendingAuth.redirectUri,
      scopes: pendingAuth.scopes,
      codeChallenge: pendingAuth.pkce.challenge,
      originalState: pendingAuth.state,
      resource: pendingAuth.resource,
      userSub,
      // Progressive/Incremental Authorization from pending record
      isIncremental: pendingAuth.isIncremental || isIncremental,
      targetAppId: pendingAuth.targetAppId || this.state.targetAppId,
      targetToolId: pendingAuth.targetToolId,
      existingSessionId: pendingAuth.existingSessionId,
      existingAuthorizationId: pendingAuth.existingAuthorizationId,
      // Federated Login
      isFederated: isFederated || !!pendingAuth.federatedLogin,
      selectedProviders: selectedProviders,
      skippedProviders: skippedProviders,
      // Consent
      consentEnabled,
      selectedTools: finalSelectedTools,
    });

    // Clean up the pending authorization
    await localAuth.authorizationStore.deletePendingAuthorization(pendingAuthId);
  }

  /**
   * Handle incremental authorization - expand existing session's token vault
   * For incremental auth, we add the app to the existing authorization without
   * requiring full re-authentication
   */
  @Stage('handleIncrementalAuth')
  async handleIncrementalAuth() {
    const { isIncremental, targetAppId, existingAuthorizationId, redirectUri } = this.state;

    // Skip if not incremental auth
    if (!isIncremental || !targetAppId) {
      return;
    }

    this.logger.info(`Processing incremental authorization for app: ${targetAppId}`);

    // For incremental auth, we need to:
    // 1. Validate the existing session (if provided)
    // 2. Generate a special incremental auth code that includes the app ID
    // 3. The token endpoint will then expand the authorization

    // For now, we pass the incremental auth info through the authorization code
    // The token exchange will handle expanding the authorization

    // Store incremental auth metadata for the token exchange
    // This will be encoded in the authorization code or stored separately
    this.logger.info(
      `Incremental auth prepared for app: ${targetAppId}, existing auth: ${existingAuthorizationId || 'none'}`,
    );
  }

  @Stage('createAuthorizationCode')
  async createAuthorizationCode() {
    const {
      clientId,
      redirectUri,
      scopes,
      codeChallenge,
      originalState,
      resource,
      email,
      name,
      userSub,
      // Consent and Federated Login
      consentEnabled,
      selectedTools,
      isFederated,
      selectedProviders,
      skippedProviders,
    } = this.state.required;

    // Validate required fields before creating authorization code
    if (!clientId || !redirectUri || !codeChallenge || !userSub) {
      const missingFields = [
        !clientId && 'clientId',
        !redirectUri && 'redirectUri',
        !codeChallenge && 'codeChallenge',
        !userSub && 'userSub',
      ].filter(Boolean);
      this.logger.error(`Missing required fields for authorization code: ${missingFields.join(', ')}`);
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', 'Authorization request is incomplete. Please try again.'),
          500,
        ),
      );
      return;
    }

    const localAuth = this.scope.auth as LocalPrimaryAuth;

    // Create the authorization code with consent/federated data
    const code = await localAuth.createAuthorizationCode({
      clientId,
      redirectUri,
      scopes: scopes ?? [],
      codeChallenge,
      userSub,
      userEmail: email,
      userName: name,
      state: originalState,
      resource,
      // Consent and Federated Login Data
      selectedToolIds: selectedTools,
      selectedProviderIds: selectedProviders,
      skippedProviderIds: skippedProviders,
      consentEnabled: consentEnabled,
      federatedLoginUsed: isFederated,
    });

    this.logger.info(
      `Authorization code created for user: ${userSub}${
        consentEnabled ? ` with ${selectedTools?.length || 0} selected tools` : ''
      }${isFederated ? ` (federated with ${selectedProviders?.length || 0} providers)` : ''}`,
    );
    this.state.set('authorizationCode', code);
  }

  @Stage('redirectToClient')
  async redirectToClient() {
    const { redirectUri, authorizationCode, originalState, isIncremental, targetAppId } = this.state.required;

    // Validate required fields for redirect
    if (!redirectUri || !authorizationCode) {
      this.logger.error('Missing redirectUri or authorizationCode for redirect');
      this.respond(
        httpRespond.html(
          this.renderErrorPage('server_error', 'Failed to complete authorization. Please try again.'),
          500,
        ),
      );
      return;
    }

    // Build the redirect URL with the authorization code
    const url = new URL(redirectUri);
    url.searchParams.set('code', authorizationCode);
    if (originalState) {
      url.searchParams.set('state', originalState);
    }

    // For incremental auth, include the app ID in the redirect
    // This allows the client to know which app was just authorized
    if (isIncremental && targetAppId) {
      url.searchParams.set('incremental', 'true');
      url.searchParams.set('app_id', targetAppId);
    }

    this.logger.info(
      `Redirecting to client: ${url.origin}${url.pathname}${
        isIncremental ? ` (incremental for app: ${targetAppId})` : ''
      }`,
    );
    this.respond(httpRespond.redirect(url.toString()));
  }

  /**
   * Generate a stable user sub from email
   * In production, this would be the user's ID from the database
   */
  private generateUserSub(email: string): string {
    // Create a deterministic UUID from the email for demo purposes
    // In production, this would be the actual user ID
    const hash = createHash('sha256').update(email.toLowerCase()).digest('hex');
    // Format as UUID
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  /**
   * Render an error page
   */
  private renderErrorPage(error: string, description: string): string {
    // Escape user-provided content to prevent XSS attacks
    const safeError = escapeHtml(error);
    const safeDescription = escapeHtml(description);

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
    .retry-link {
      display: inline-block;
      margin-top: 20px;
      color: #667eea;
      text-decoration: none;
    }
    .retry-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>Authorization Error</h1>
    <p><span class="error-code">${safeError}</span></p>
    <p>${safeDescription}</p>
    <a href="javascript:history.back()" class="retry-link">← Go Back</a>
  </div>
</body>
</html>`;
  }
}
