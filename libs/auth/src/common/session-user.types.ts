/**
 * Portable session user type extracted from SDK's session.base.ts.
 * Used by auth components that need user identity without SDK Scope dependency.
 */
export interface SessionUser {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

/**
 * Generic session claims map.
 */
export interface SessionClaims {
  [key: string]: unknown;
}
