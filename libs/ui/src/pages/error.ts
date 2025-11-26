/**
 * Error Page Templates
 *
 * Various error page templates (404, 500, etc.)
 */

import { errorLayout, type ErrorLayoutOptions } from '../layouts';
import { escapeHtml } from '../layouts/base';

// ============================================
// Error Page Types
// ============================================

/**
 * Error page options
 */
export interface ErrorPageOptions {
  /** Error code (404, 500, etc.) */
  code?: string | number;
  /** Error title */
  title?: string;
  /** Error message */
  message?: string;
  /** Detailed error (for development) */
  details?: string;
  /** Show stack trace (development only) */
  showStack?: boolean;
  /** Stack trace */
  stack?: string;
  /** Show retry button */
  showRetry?: boolean;
  /** Retry URL */
  retryUrl?: string;
  /** Show home button */
  showHome?: boolean;
  /** Home URL */
  homeUrl?: string;
  /** Show back button */
  showBack?: boolean;
  /** Custom actions HTML */
  actions?: string;
  /** Layout options */
  layout?: Partial<ErrorLayoutOptions>;
  /** Request ID (for support) */
  requestId?: string;
}

// ============================================
// Error Page Builder
// ============================================

/**
 * Build a generic error page
 */
export function errorPage(options: ErrorPageOptions): string {
  const {
    code,
    title = 'Something went wrong',
    message,
    details,
    showStack = false,
    stack,
    showRetry = true,
    retryUrl,
    showHome = true,
    homeUrl = '/',
    showBack = false,
    actions,
    layout = {},
    requestId,
  } = options;

  // Details section (for development)
  const detailsHtml =
    details || (showStack && stack)
      ? `
    <div class="mt-8 text-left">
      ${
        details
          ? `
        <div class="p-4 bg-gray-50 rounded-lg text-sm text-text-secondary mb-4">
          <strong class="text-text-primary">Details:</strong>
          <p class="mt-1">${escapeHtml(details)}</p>
        </div>
      `
          : ''
      }
      ${
        showStack && stack
          ? `
        <details class="p-4 bg-gray-900 rounded-lg text-sm">
          <summary class="text-gray-300 cursor-pointer hover:text-white">Stack Trace</summary>
          <pre class="mt-2 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">${escapeHtml(stack)}</pre>
        </details>
      `
          : ''
      }
    </div>
  `
      : '';

  // Request ID for support
  const requestIdHtml = requestId
    ? `
    <p class="text-xs text-text-secondary mt-6">
      Request ID: <code class="px-1.5 py-0.5 bg-gray-100 rounded text-xs">${escapeHtml(requestId)}</code>
    </p>
  `
    : '';

  // Custom actions or default buttons are handled by errorLayout
  const content = `
    ${detailsHtml}
    ${actions || ''}
    ${requestIdHtml}
  `;

  return errorLayout(content, {
    title: `${code ? `Error ${code} - ` : ''}${title}`,
    errorCode: code?.toString(),
    errorTitle: title,
    errorMessage: message,
    showRetry,
    retryUrl,
    showHome,
    homeUrl,
    ...layout,
  });
}

// ============================================
// Specific Error Pages
// ============================================

/**
 * 404 Not Found page
 */
export function notFoundPage(options: Partial<ErrorPageOptions> = {}): string {
  return errorPage({
    code: 404,
    title: 'Page Not Found',
    message: "The page you're looking for doesn't exist or has been moved.",
    showRetry: false,
    ...options,
  });
}

/**
 * 403 Forbidden page
 */
export function forbiddenPage(options: Partial<ErrorPageOptions> = {}): string {
  return errorPage({
    code: 403,
    title: 'Access Denied',
    message: "You don't have permission to access this resource.",
    showRetry: false,
    ...options,
  });
}

/**
 * 401 Unauthorized page
 */
export function unauthorizedPage(options: Partial<ErrorPageOptions> & { loginUrl?: string } = {}): string {
  const { loginUrl = '/login', ...rest } = options;

  return errorPage({
    code: 401,
    title: 'Authentication Required',
    message: 'Please sign in to access this resource.',
    showRetry: false,
    showHome: false,
    actions: `
      <div class="flex justify-center mt-8">
        <a href="${escapeHtml(
          loginUrl,
        )}" class="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors">
          Sign In
        </a>
      </div>
    `,
    ...rest,
  });
}

/**
 * 500 Internal Server Error page
 */
export function serverErrorPage(options: Partial<ErrorPageOptions> = {}): string {
  return errorPage({
    code: 500,
    title: 'Server Error',
    message: "We're having trouble processing your request. Please try again later.",
    showRetry: true,
    ...options,
  });
}

/**
 * 503 Service Unavailable page
 */
export function maintenancePage(options: Partial<ErrorPageOptions> & { estimatedTime?: string } = {}): string {
  const { estimatedTime, ...rest } = options;

  const timeMessage = estimatedTime
    ? `We expect to be back by ${escapeHtml(estimatedTime)}.`
    : "We'll be back shortly.";

  return errorPage({
    code: 503,
    title: 'Under Maintenance',
    message: `We're currently performing scheduled maintenance. ${timeMessage}`,
    showRetry: true,
    showHome: false,
    ...rest,
  });
}

/**
 * 429 Rate Limit page
 */
export function rateLimitPage(options: Partial<ErrorPageOptions> & { retryAfter?: number } = {}): string {
  const { retryAfter, ...rest } = options;

  const retryMessage = retryAfter
    ? `Please wait ${retryAfter} seconds before trying again.`
    : 'Please wait a moment before trying again.';

  return errorPage({
    code: 429,
    title: 'Too Many Requests',
    message: `You've made too many requests. ${retryMessage}`,
    showRetry: true,
    showHome: true,
    ...rest,
  });
}

/**
 * Offline page
 */
export function offlinePage(options: Partial<ErrorPageOptions> = {}): string {
  return errorPage({
    title: "You're Offline",
    message: 'Please check your internet connection and try again.',
    showRetry: true,
    showHome: false,
    ...options,
    layout: {
      ...options.layout,
    },
  });
}

/**
 * Session expired page
 */
export function sessionExpiredPage(options: Partial<ErrorPageOptions> & { loginUrl?: string } = {}): string {
  const { loginUrl = '/login', ...rest } = options;

  return errorPage({
    title: 'Session Expired',
    message: 'Your session has expired. Please sign in again to continue.',
    showRetry: false,
    showHome: false,
    actions: `
      <div class="flex justify-center mt-8">
        <a href="${escapeHtml(
          loginUrl,
        )}" class="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors">
          Sign In Again
        </a>
      </div>
    `,
    ...rest,
  });
}

// ============================================
// OAuth Error Pages
// ============================================

/**
 * OAuth error page options
 */
export interface OAuthErrorPageOptions extends Partial<ErrorPageOptions> {
  /** OAuth error code */
  errorCode?: string;
  /** OAuth error description */
  errorDescription?: string;
  /** Redirect URI */
  redirectUri?: string;
  /** Client name */
  clientName?: string;
}

/**
 * OAuth error page
 */
export function oauthErrorPage(options: OAuthErrorPageOptions): string {
  const { errorCode, errorDescription, redirectUri, clientName, ...rest } = options;

  // Map OAuth error codes to user-friendly messages
  const errorMessages: Record<string, { title: string; message: string }> = {
    invalid_request: {
      title: 'Invalid Request',
      message: 'The authorization request is missing required parameters or is malformed.',
    },
    unauthorized_client: {
      title: 'Unauthorized Client',
      message: 'The client is not authorized to request an authorization code.',
    },
    access_denied: {
      title: 'Access Denied',
      message: 'The resource owner denied the authorization request.',
    },
    unsupported_response_type: {
      title: 'Unsupported Response Type',
      message: 'The authorization server does not support the requested response type.',
    },
    invalid_scope: {
      title: 'Invalid Scope',
      message: 'The requested scope is invalid, unknown, or malformed.',
    },
    server_error: {
      title: 'Server Error',
      message: 'The authorization server encountered an unexpected error.',
    },
    temporarily_unavailable: {
      title: 'Temporarily Unavailable',
      message: 'The authorization server is temporarily unavailable. Please try again later.',
    },
  };

  const errorInfo =
    errorCode && errorMessages[errorCode]
      ? errorMessages[errorCode]
      : { title: 'Authorization Error', message: errorDescription || 'An error occurred during authorization.' };

  const clientMessage = clientName ? ` while connecting to ${escapeHtml(clientName)}` : '';

  const redirectAction = redirectUri
    ? `
    <a href="${escapeHtml(
      redirectUri,
    )}" class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-text-primary font-medium rounded-lg transition-colors">
      Return to ${clientName ? escapeHtml(clientName) : 'Application'}
    </a>
  `
    : '';

  return errorPage({
    title: errorInfo.title,
    message: `${errorInfo.message}${clientMessage}`,
    details: errorCode && errorDescription ? `Error: ${errorCode}\n${errorDescription}` : undefined,
    showRetry: errorCode === 'server_error' || errorCode === 'temporarily_unavailable',
    showHome: true,
    actions: redirectAction ? `<div class="flex justify-center gap-4 mt-8">${redirectAction}</div>` : undefined,
    ...rest,
  });
}
