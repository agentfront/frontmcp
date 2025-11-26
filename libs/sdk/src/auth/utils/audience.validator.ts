// auth/utils/audience.validator.ts

/**
 * Audience Validator
 *
 * Validates JWT audience claims per RFC 7519 and MCP Authorization spec.
 * The audience (aud) claim identifies the recipients that the JWT is intended for.
 */

/**
 * Validation result
 */
export interface AudienceValidationResult {
  /** Whether the audience is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Matched audience value (if valid) */
  matchedAudience?: string;
}

/**
 * Audience validator options
 */
export interface AudienceValidatorOptions {
  /**
   * Expected audience values
   * Token must contain at least one of these audiences
   */
  expectedAudiences: string[];

  /**
   * Whether to allow tokens with no audience claim
   * @default false
   */
  allowNoAudience?: boolean;

  /**
   * Case-sensitive comparison
   * @default true
   */
  caseSensitive?: boolean;

  /**
   * Allow wildcard matching (e.g., *.example.com)
   * @default false
   */
  allowWildcards?: boolean;
}

/**
 * Validate JWT audience claim
 *
 * @param tokenAudience - The audience claim from the JWT (can be string or array)
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * // Single expected audience
 * validateAudience('https://api.example.com', {
 *   expectedAudiences: ['https://api.example.com'],
 * });
 * // => { valid: true, matchedAudience: 'https://api.example.com' }
 *
 * // Multiple audiences in token
 * validateAudience(['aud1', 'aud2', 'aud3'], {
 *   expectedAudiences: ['aud2'],
 * });
 * // => { valid: true, matchedAudience: 'aud2' }
 *
 * // No match
 * validateAudience('wrong-aud', {
 *   expectedAudiences: ['expected-aud'],
 * });
 * // => { valid: false, error: 'Token audience does not match expected audiences' }
 * ```
 */
export function validateAudience(
  tokenAudience: string | string[] | undefined,
  options: AudienceValidatorOptions,
): AudienceValidationResult {
  const { expectedAudiences, allowNoAudience = false, caseSensitive = true, allowWildcards = false } = options;

  // Handle missing audience
  if (tokenAudience === undefined || tokenAudience === null) {
    if (allowNoAudience) {
      return { valid: true };
    }
    return {
      valid: false,
      error: 'Token is missing audience claim',
    };
  }

  // Handle empty expected audiences (accept any)
  if (expectedAudiences.length === 0) {
    const firstAud = Array.isArray(tokenAudience) ? tokenAudience[0] : tokenAudience;
    return { valid: true, matchedAudience: firstAud };
  }

  // Normalize token audience to array
  const tokenAuds = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];

  // Check each token audience against expected audiences
  for (const tokenAud of tokenAuds) {
    for (const expectedAud of expectedAudiences) {
      if (matchesAudience(tokenAud, expectedAud, caseSensitive, allowWildcards)) {
        return { valid: true, matchedAudience: tokenAud };
      }
    }
  }

  return {
    valid: false,
    error: `Token audience does not match expected audiences. Got: ${tokenAuds.join(
      ', ',
    )}. Expected one of: ${expectedAudiences.join(', ')}`,
  };
}

/**
 * Check if a token audience matches an expected audience
 */
function matchesAudience(
  tokenAud: string,
  expectedAud: string,
  caseSensitive: boolean,
  allowWildcards: boolean,
): boolean {
  // Direct match
  if (caseSensitive) {
    if (tokenAud === expectedAud) return true;
  } else {
    if (tokenAud.toLowerCase() === expectedAud.toLowerCase()) return true;
  }

  // Wildcard matching
  if (allowWildcards && expectedAud.includes('*')) {
    const pattern = expectedAud
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Convert * to .*
    const regex = new RegExp(`^${pattern}$`, caseSensitive ? '' : 'i');
    if (regex.test(tokenAud)) return true;
  }

  return false;
}

/**
 * Create an audience validator function
 *
 * @param options - Validator options
 * @returns A validation function that takes token audience and returns validation result
 *
 * @example
 * ```typescript
 * const validator = createAudienceValidator({
 *   expectedAudiences: ['https://api.example.com', 'https://api.example.org'],
 * });
 *
 * validator('https://api.example.com'); // => { valid: true, ... }
 * validator('wrong-aud'); // => { valid: false, ... }
 * ```
 */
export function createAudienceValidator(
  options: AudienceValidatorOptions,
): (audience: string | string[] | undefined) => AudienceValidationResult {
  return (audience) => validateAudience(audience, options);
}

/**
 * Derive expected audience from the resource URL
 *
 * Per MCP Authorization spec, the audience should typically be the
 * resource server URL (the MCP server URL).
 *
 * @param resourceUrl - The resource server URL
 * @returns Array of expected audiences
 *
 * @example
 * ```typescript
 * deriveExpectedAudience('https://api.example.com/v1/mcp');
 * // => ['https://api.example.com/v1/mcp', 'https://api.example.com', 'api.example.com']
 * ```
 */
export function deriveExpectedAudience(resourceUrl: string): string[] {
  const audiences: string[] = [];

  try {
    const url = new URL(resourceUrl);

    // Full URL (most specific)
    audiences.push(resourceUrl.replace(/\/$/, ''));

    // Origin only (e.g., https://api.example.com)
    if (url.pathname !== '/' && url.pathname !== '') {
      audiences.push(url.origin);
    }

    // Host only (e.g., api.example.com)
    audiences.push(url.host);
  } catch {
    // If not a valid URL, use as-is
    audiences.push(resourceUrl);
  }

  return audiences;
}

/**
 * AudienceValidator class for reusable validation with configuration
 */
export class AudienceValidator {
  private options: AudienceValidatorOptions;

  constructor(options: Partial<AudienceValidatorOptions> & { expectedAudiences?: string[] } = {}) {
    this.options = {
      expectedAudiences: options.expectedAudiences ?? [],
      allowNoAudience: options.allowNoAudience ?? false,
      caseSensitive: options.caseSensitive ?? true,
      allowWildcards: options.allowWildcards ?? false,
    };
  }

  /**
   * Validate an audience claim
   */
  validate(audience: string | string[] | undefined): AudienceValidationResult {
    return validateAudience(audience, this.options);
  }

  /**
   * Add expected audiences
   */
  addAudiences(...audiences: string[]): void {
    this.options.expectedAudiences.push(...audiences);
  }

  /**
   * Set expected audiences (replace existing)
   */
  setAudiences(audiences: string[]): void {
    this.options.expectedAudiences = audiences;
  }

  /**
   * Create validator from resource URL
   */
  static fromResourceUrl(
    resourceUrl: string,
    options: Omit<AudienceValidatorOptions, 'expectedAudiences'> = {},
  ): AudienceValidator {
    return new AudienceValidator({
      ...options,
      expectedAudiences: deriveExpectedAudience(resourceUrl),
    });
  }
}
