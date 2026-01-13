/**
 * Auth Utilities
 */

export {
  buildWwwAuthenticate,
  buildPrmUrl,
  buildUnauthorizedHeader,
  buildInvalidTokenHeader,
  buildInsufficientScopeHeader,
  buildInvalidRequestHeader,
  parseWwwAuthenticate,
} from './www-authenticate.utils';
export type { BearerErrorCode, WwwAuthenticateOptions } from './www-authenticate.utils';

export {
  validateAudience,
  createAudienceValidator,
  deriveExpectedAudience,
  AudienceValidator,
} from './audience.validator';
export type { AudienceValidationResult, AudienceValidatorOptions } from './audience.validator';
