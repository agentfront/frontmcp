/// <reference types="jest" />
/**
 * OAuth Test Fixtures
 *
 * Utilities for testing OAuth 2.1 flows including PKCE generation,
 * request parameter builders, and common OAuth scenarios.
 */

import { generatePkceChallenge, PkceChallenge } from '../../auth/session';
import { createMockHttpRequest } from './flow.fixtures';

// ============================================
// Types
// ============================================

/**
 * OAuth authorization request parameters
 */
export interface OAuthAuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
  // Progressive authorization
  mode?: string;
  app?: string;
  tool?: string;
  session_id?: string;
}

/**
 * PKCE pair containing verifier and challenge
 */
export interface PkcePair {
  verifier: string;
  challenge: PkceChallenge;
}

// ============================================
// PKCE Utilities
// ============================================

/**
 * Characters allowed in PKCE code verifiers (RFC 7636)
 */
const PKCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generates a cryptographically random PKCE code verifier
 *
 * @param length - Length of verifier (43-128, default 64)
 * @returns Code verifier string
 *
 * @example
 * ```typescript
 * const verifier = generateCodeVerifier();
 * const challenge = generatePkceChallenge(verifier);
 * ```
 */
export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error('Code verifier length must be between 43 and 128 characters');
  }

  let verifier = '';
  for (let i = 0; i < length; i++) {
    verifier += PKCE_CHARS.charAt(Math.floor(Math.random() * PKCE_CHARS.length));
  }
  return verifier;
}

/**
 * Generates a complete PKCE pair (verifier + challenge)
 *
 * @returns Object with verifier and challenge
 *
 * @example
 * ```typescript
 * const pkce = generatePkcePair();
 * console.log(pkce.verifier);          // "abc123..."
 * console.log(pkce.challenge.method);  // "S256"
 * console.log(pkce.challenge.challenge); // "xyz789..."
 * ```
 */
export function generatePkcePair(): PkcePair {
  const verifier = generateCodeVerifier();
  const challenge = generatePkceChallenge(verifier);
  return { verifier, challenge };
}

// ============================================
// OAuth Request Builders
// ============================================

/**
 * Creates valid OAuth 2.1 authorization request parameters
 *
 * @param overrides - Parameters to override defaults
 * @returns Complete OAuth authorize request parameters
 *
 * @example
 * ```typescript
 * // Basic valid request
 * const params = createValidOAuthRequest();
 *
 * // With custom client
 * const params = createValidOAuthRequest({ client_id: 'my-client' });
 *
 * // With custom scopes
 * const params = createValidOAuthRequest({ scope: 'openid profile email' });
 * ```
 */
export function createValidOAuthRequest(
  overrides: Partial<OAuthAuthorizeParams> = {},
): OAuthAuthorizeParams & { _pkce: PkcePair } {
  const pkce = generatePkcePair();

  const params = {
    response_type: 'code',
    client_id: 'test-client-id',
    redirect_uri: 'https://client.example.com/callback',
    code_challenge: pkce.challenge.challenge,
    code_challenge_method: 'S256',
    scope: 'openid profile',
    state: `state-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...overrides,
    // Attach PKCE pair for verification in tests
    _pkce: pkce,
  };

  return params;
}

/**
 * Creates OAuth request parameters for anonymous/default provider mode
 *
 * @param overrides - Parameters to override defaults
 * @returns Minimal anonymous request parameters
 */
export function createAnonymousOAuthRequest(overrides: Partial<OAuthAuthorizeParams> = {}): OAuthAuthorizeParams {
  return {
    redirect_uri: 'https://client.example.com/callback',
    state: overrides.state,
    ...overrides,
  };
}

/**
 * Creates OAuth request parameters for incremental authorization
 *
 * @param appId - Target app to authorize
 * @param toolId - Optional specific tool
 * @param sessionId - Existing session ID
 * @param overrides - Additional parameters
 */
export function createIncrementalAuthRequest(
  appId: string,
  toolId?: string,
  sessionId?: string,
  overrides: Partial<OAuthAuthorizeParams> = {},
): OAuthAuthorizeParams & { _pkce: PkcePair } {
  const baseRequest = createValidOAuthRequest(overrides);

  return {
    ...baseRequest,
    mode: 'incremental',
    app: appId,
    tool: toolId,
    session_id: sessionId,
  };
}

/**
 * Creates a mock HTTP input object for OAuth authorize flow
 *
 * @param params - OAuth request parameters
 * @returns Mock HTTP request input
 *
 * @example
 * ```typescript
 * const params = createValidOAuthRequest();
 * const input = createOAuthInput(params);
 * const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());
 * ```
 */
export function createOAuthInput(params: OAuthAuthorizeParams) {
  // Convert params to query string format (excluding internal _pkce)
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== '_pkce' && value !== undefined) {
      query[key] = String(value);
    }
  }

  return createMockHttpRequest({
    method: 'GET',
    path: '/oauth/authorize',
    query,
  });
}

// ============================================
// Invalid Request Generators
// ============================================

/**
 * Collection of invalid OAuth request generators for error testing
 */
export const invalidOAuthRequests = {
  /**
   * Missing redirect_uri
   */
  missingRedirectUri: () => {
    const params = createValidOAuthRequest();
    delete (params as any).redirect_uri;
    return params;
  },

  /**
   * Invalid redirect_uri (not a URL)
   */
  invalidRedirectUri: () =>
    createValidOAuthRequest({
      redirect_uri: 'not-a-valid-url',
    }),

  /**
   * Missing response_type
   */
  missingResponseType: () => {
    const params = createValidOAuthRequest();
    delete (params as any).response_type;
    return params;
  },

  /**
   * Invalid response_type (not 'code')
   */
  invalidResponseType: () =>
    createValidOAuthRequest({
      response_type: 'token', // OAuth 2.1 doesn't allow implicit flow
    }),

  /**
   * Missing client_id
   */
  missingClientId: () => {
    const params = createValidOAuthRequest();
    delete (params as any).client_id;
    return params;
  },

  /**
   * Empty client_id
   */
  emptyClientId: () =>
    createValidOAuthRequest({
      client_id: '',
    }),

  /**
   * Missing code_challenge (PKCE required in OAuth 2.1)
   */
  missingCodeChallenge: () => {
    const params = createValidOAuthRequest();
    delete (params as any).code_challenge;
    return params;
  },

  /**
   * Code challenge too short (< 43 chars)
   */
  shortCodeChallenge: () =>
    createValidOAuthRequest({
      code_challenge: 'too-short',
    }),

  /**
   * Code challenge too long (> 128 chars)
   */
  longCodeChallenge: () =>
    createValidOAuthRequest({
      code_challenge: 'a'.repeat(130),
    }),

  /**
   * Invalid code_challenge_method (not S256)
   */
  plainCodeChallengeMethod: () =>
    createValidOAuthRequest({
      code_challenge_method: 'plain', // OAuth 2.1 requires S256
    }),

  /**
   * Multiple errors combined
   */
  multipleErrors: () =>
    createValidOAuthRequest({
      response_type: 'token',
      client_id: '',
      code_challenge: 'short',
    }),
};

// ============================================
// OAuth Response Helpers
// ============================================

/**
 * Parses an OAuth redirect URL to extract parameters
 *
 * @param url - Redirect URL string
 * @returns Parsed query parameters
 *
 * @example
 * ```typescript
 * const params = parseOAuthRedirect('https://example.com/callback?code=abc&state=xyz');
 * expect(params.code).toBe('abc');
 * expect(params.state).toBe('xyz');
 * ```
 */
export function parseOAuthRedirect(url: string): Record<string, string> {
  const parsed = new URL(url);
  const params: Record<string, string> = {};

  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return params;
}

/**
 * Extracts OAuth error details from a redirect URL
 *
 * @param url - Error redirect URL
 * @returns Error details
 */
export function parseOAuthError(url: string): {
  error: string;
  errorDescription?: string;
  state?: string;
} {
  const params = parseOAuthRedirect(url);

  return {
    error: params['error'] || '',
    errorDescription: params['error_description'],
    state: params['state'],
  };
}

// ============================================
// Assertion Helpers
// ============================================

/**
 * Asserts that a redirect response contains expected OAuth parameters
 *
 * @param output - Flow output to check
 * @param expected - Expected parameters
 */
export function expectOAuthRedirect(
  output: any,
  expected: {
    code?: string | RegExp;
    state?: string;
    error?: string;
    errorContains?: string;
  },
) {
  expect(output.kind).toBe('redirect');
  expect(output.location).toBeDefined();

  const params = parseOAuthRedirect(output.location);

  if (expected.code !== undefined) {
    if (expected.code instanceof RegExp) {
      expect(params['code']).toMatch(expected.code);
    } else {
      expect(params['code']).toBe(expected.code);
    }
  }

  if (expected.state !== undefined) {
    expect(params['state']).toBe(expected.state);
  }

  if (expected.error !== undefined) {
    expect(params['error']).toBe(expected.error);
  }

  if (expected.errorContains !== undefined) {
    expect(params['error_description'] || '').toContain(expected.errorContains);
  }

  return params;
}

/**
 * Asserts that an HTML response contains expected content
 *
 * @param output - Flow output to check
 * @param expected - Expected content
 */
export function expectOAuthHtmlPage(
  output: any,
  expected: {
    status?: number;
    contains?: string[];
    notContains?: string[];
  },
) {
  expect(output.kind).toBe('html');

  if (expected.status !== undefined) {
    expect(output.status).toBe(expected.status);
  }

  if (expected.contains) {
    for (const text of expected.contains) {
      expect(output.body).toContain(text);
    }
  }

  if (expected.notContains) {
    for (const text of expected.notContains) {
      expect(output.body).not.toContain(text);
    }
  }

  return output.body;
}
