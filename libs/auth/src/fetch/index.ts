/**
 * Fetch Credential Middleware Module
 *
 * Provides middleware for injecting upstream provider credentials into outgoing
 * fetch requests via the `credentials: { provider: '...' }` pattern.
 * Auth providers decide HOW to apply credentials (Bearer, API key, query param, basic).
 */

export {
  FetchCredentialMiddleware,
  bearerApplier,
  basicApplier,
  headerApplier,
  queryApplier,
} from './fetch-credential-middleware';

export type {
  TokenAccessor,
  CredentialApplier,
  FrontMcpCredentials,
  FrontMcpFetchInit,
} from './fetch-credential-middleware';
