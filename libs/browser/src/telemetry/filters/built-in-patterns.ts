// file: libs/browser/src/telemetry/filters/built-in-patterns.ts
/**
 * Built-in PII Patterns
 *
 * Regular expression patterns for common PII data types.
 */

import type { PiiPattern } from '../types';

// =============================================================================
// Patterns
// =============================================================================

/**
 * Email pattern.
 */
export const EMAIL_PATTERN: PiiPattern = {
  name: 'email',
  pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  replacement: '[EMAIL]',
};

/**
 * Credit card pattern (major card formats).
 */
export const CREDIT_CARD_PATTERN: PiiPattern = {
  name: 'creditCard',
  // Visa, MasterCard, Amex, Discover patterns
  pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b|\b\d{15,16}\b/g,
  replacement: '[CREDIT_CARD]',
};

/**
 * Social Security Number pattern (US).
 */
export const SSN_PATTERN: PiiPattern = {
  name: 'ssn',
  pattern: /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,
  replacement: '[SSN]',
};

/**
 * Phone number pattern (various formats).
 */
export const PHONE_PATTERN: PiiPattern = {
  name: 'phone',
  // Matches various phone formats including international
  pattern: /\b(?:\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g,
  replacement: '[PHONE]',
};

/**
 * API key pattern (common formats).
 */
export const API_KEY_PATTERN: PiiPattern = {
  name: 'apiKey',
  // Matches common API key patterns (hex strings, base64-like)
  pattern: /\b(?:api[_-]?key|apikey|api[_-]?secret)[=:]["']?([a-zA-Z0-9_-]{20,})["']?\b/gi,
  replacement: '[API_KEY]',
};

/**
 * Bearer token pattern.
 */
export const BEARER_TOKEN_PATTERN: PiiPattern = {
  name: 'bearerToken',
  pattern: /\bBearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  replacement: 'Bearer [TOKEN]',
};

/**
 * JWT pattern.
 */
export const JWT_PATTERN: PiiPattern = {
  name: 'jwt',
  // Matches JWT format: header.payload.signature
  pattern: /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
  replacement: '[JWT]',
};

/**
 * IPv4 pattern.
 */
export const IPV4_PATTERN: PiiPattern = {
  name: 'ipv4',
  pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  replacement: '[IP]',
};

/**
 * IPv6 pattern (simplified).
 */
export const IPV6_PATTERN: PiiPattern = {
  name: 'ipv6',
  pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
  replacement: '[IP]',
};

/**
 * Password field pattern (in URLs or key-value pairs).
 */
export const PASSWORD_PATTERN: PiiPattern = {
  name: 'password',
  pattern: /\b(?:password|passwd|pwd|secret)[=:]["']?([^"'&\s]+)["']?/gi,
  replacement: '$1=[REDACTED]',
};

/**
 * Authorization header pattern.
 */
export const AUTH_HEADER_PATTERN: PiiPattern = {
  name: 'authHeader',
  pattern: /\bAuthorization[=:]\s*["']?[^"'\n]+["']?/gi,
  replacement: 'Authorization: [REDACTED]',
};

/**
 * AWS access key pattern.
 */
export const AWS_KEY_PATTERN: PiiPattern = {
  name: 'awsKey',
  pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  replacement: '[AWS_KEY]',
};

/**
 * Private key pattern (PEM format headers).
 */
export const PRIVATE_KEY_PATTERN: PiiPattern = {
  name: 'privateKey',
  pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
  replacement: '[PRIVATE_KEY]',
};

// =============================================================================
// All Patterns
// =============================================================================

/**
 * All built-in PII patterns.
 */
export const BUILTIN_PATTERNS: PiiPattern[] = [
  EMAIL_PATTERN,
  CREDIT_CARD_PATTERN,
  SSN_PATTERN,
  PHONE_PATTERN,
  API_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  JWT_PATTERN,
  IPV4_PATTERN,
  IPV6_PATTERN,
  PASSWORD_PATTERN,
  AUTH_HEADER_PATTERN,
  AWS_KEY_PATTERN,
  PRIVATE_KEY_PATTERN,
];

/**
 * Get a built-in pattern by name.
 */
export function getBuiltinPattern(name: string): PiiPattern | undefined {
  return BUILTIN_PATTERNS.find((p) => p.name === name);
}

/**
 * Get multiple built-in patterns by name.
 */
export function getBuiltinPatterns(names: string[]): PiiPattern[] {
  return names.map((name) => getBuiltinPattern(name)).filter((p): p is PiiPattern => p !== undefined);
}

/**
 * Get all pattern names.
 */
export function getPatternNames(): string[] {
  return BUILTIN_PATTERNS.map((p) => p.name);
}
