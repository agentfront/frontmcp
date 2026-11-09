/**
 * JWKS Module
 *
 * JSON Web Key Set management for JWT signing and verification.
 */

// Types
export type { JwksServiceOptions, ProviderVerifyRef, TokenVerifyFailure, VerifyResult } from './jwks.types';

// Service
export { JwksService } from './jwks.service';
export { LocalTokenKeys } from './local-token-keys';
export type { LocalSigningKeyConfig } from './local-token-keys';

// Utils
export { trimSlash, normalizeIssuer, decodeJwtPayloadSafe } from './jwks.utils';
