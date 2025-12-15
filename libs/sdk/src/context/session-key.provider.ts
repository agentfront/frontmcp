import { InvalidInputError } from '../errors/mcp.error';

/**
 * Session key wrapper for DI injection in SESSION-scoped providers.
 *
 * FrontMCP's DI system uses class tokens (reads `design:paramtypes` from constructors).
 * This class wraps the session ID so it can be injected via constructor parameters.
 *
 * The SessionKey is validated at construction to prevent:
 * - Memory bombs (very long session IDs)
 * - Log injection attacks (special characters)
 * - Cache exhaustion (unique massive IDs)
 *
 * @example
 * ```typescript
 * import { Provider, ProviderScope, SessionKey } from '@frontmcp/sdk';
 *
 * @Provider({ scope: ProviderScope.SESSION })
 * class SessionScopedCache {
 *   constructor(private readonly sessionKey: SessionKey) {
 *     // sessionKey.value available at construction time
 *     const sessionId = sessionKey.value;
 *   }
 * }
 * ```
 */
export class SessionKey {
  /** Maximum allowed length for session keys */
  static readonly MAX_LENGTH = 256;

  /**
   * Valid characters for session keys:
   * - Alphanumeric (a-z, A-Z, 0-9)
   * - Hyphen, underscore, period
   * - Colon (for namespaced IDs like "anon:uuid")
   */
  static readonly VALID_PATTERN = /^[a-zA-Z0-9\-_.:]+$/;

  /**
   * Validate a session key string without constructing.
   * Use this for early validation before cache operations.
   *
   * @param value - The session key string to validate
   * @throws InvalidInputError if validation fails (empty, too long, invalid characters)
   */
  static validate(value: string): void {
    if (!value || value.length === 0) {
      throw new InvalidInputError('SessionKey cannot be empty');
    }
    if (value.length > SessionKey.MAX_LENGTH) {
      throw new InvalidInputError(`SessionKey exceeds maximum length of ${SessionKey.MAX_LENGTH} characters`);
    }
    if (!SessionKey.VALID_PATTERN.test(value)) {
      throw new InvalidInputError(
        'SessionKey contains invalid characters. Allowed: alphanumeric, hyphen, underscore, period, colon',
      );
    }
  }

  constructor(public readonly value: string) {
    // Delegate to static method to avoid code duplication
    SessionKey.validate(value);
  }
}
