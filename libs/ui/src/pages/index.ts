/**
 * Page Templates Module
 *
 * Minimal page templates that complement SDK auth flows.
 * Login/Register flows are handled by @frontmcp/sdk auth system.
 */

// Consent pages (OAuth/OpenID consent flows)
export {
  type ClientInfo,
  type UserInfo,
  type ConsentPageOptions,
  type ConsentSuccessOptions,
  type ConsentDeniedOptions,
  consentPage,
  consentSuccessPage,
  consentDeniedPage,
} from './consent';

// Error pages (generic error display)
export {
  type ErrorPageOptions,
  type OAuthErrorPageOptions,
  errorPage,
  notFoundPage,
  forbiddenPage,
  unauthorizedPage,
  serverErrorPage,
  maintenancePage,
  rateLimitPage,
  offlinePage,
  sessionExpiredPage,
  oauthErrorPage,
} from './error';
