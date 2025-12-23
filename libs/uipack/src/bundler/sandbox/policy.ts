/**
 * Sandbox Security Policy
 *
 * Defines and validates security policies for bundler execution.
 *
 * @packageDocumentation
 */

import type { SecurityPolicy, SecurityViolation } from '../types';
import { DEFAULT_SECURITY_POLICY } from '../types';

/**
 * Patterns that indicate unsafe code.
 */
const UNSAFE_PATTERNS = {
  eval: /\beval\s*\(/g,
  functionConstructor: /\bnew\s+Function\s*\(/g,
  dynamicImport: /\bimport\s*\(/g,
  require: /\brequire\s*\(/g,
  processEnv: /\bprocess\.env\b/g,
  globalThis: /\bglobalThis\b/g,
  windowLocation: /\bwindow\.location\b/g,
  documentCookie: /\bdocument\.cookie\b/g,
  innerHTML: /\.innerHTML\s*=/g,
  outerHTML: /\.outerHTML\s*=/g,
  document_write: /\bdocument\.write\s*\(/g,
};

/**
 * Validate source code against a security policy.
 *
 * @param source - Source code to validate
 * @param policy - Security policy to enforce
 * @returns Array of security violations (empty if valid)
 *
 * @example
 * ```typescript
 * const violations = validateSource(code, DEFAULT_SECURITY_POLICY);
 * if (violations.length > 0) {
 *   throw new Error(`Security violations: ${violations.map(v => v.message).join(', ')}`);
 * }
 * ```
 */
export function validateSource(source: string, policy: SecurityPolicy = DEFAULT_SECURITY_POLICY): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  // Check for eval usage
  if (policy.noEval !== false) {
    const evalMatches = [...source.matchAll(UNSAFE_PATTERNS.eval)];
    for (const match of evalMatches) {
      violations.push({
        type: 'eval-usage',
        message: 'eval() is not allowed for security reasons',
        location: getLocation(source, match.index ?? 0),
        value: match[0],
      });
    }

    const fnMatches = [...source.matchAll(UNSAFE_PATTERNS.functionConstructor)];
    for (const match of fnMatches) {
      violations.push({
        type: 'eval-usage',
        message: 'new Function() is not allowed for security reasons',
        location: getLocation(source, match.index ?? 0),
        value: match[0],
      });
    }
  }

  // Check for dynamic imports
  if (policy.noDynamicImports !== false) {
    const matches = [...source.matchAll(UNSAFE_PATTERNS.dynamicImport)];
    for (const match of matches) {
      violations.push({
        type: 'dynamic-import',
        message: 'Dynamic imports are not allowed for security reasons',
        location: getLocation(source, match.index ?? 0),
        value: match[0],
      });
    }
  }

  // Check for require usage
  if (policy.noRequire !== false) {
    const matches = [...source.matchAll(UNSAFE_PATTERNS.require)];
    for (const match of matches) {
      violations.push({
        type: 'require-usage',
        message: 'require() is not allowed for security reasons',
        location: getLocation(source, match.index ?? 0),
        value: match[0],
      });
    }
  }

  // Validate imports
  const importViolations = validateImports(source, policy);
  violations.push(...importViolations);

  return violations;
}

/**
 * Validate import statements against policy.
 *
 * @param source - Source code to check
 * @param policy - Security policy
 * @returns Array of import violations
 */
export function validateImports(source: string, policy: SecurityPolicy = DEFAULT_SECURITY_POLICY): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  // Extract import statements
  const importPattern = /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports: Array<{ module: string; index: number }> = [];

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    imports.push({ module: match[1], index: match.index });
  }

  // Also check for require-style imports that might slip through
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(source)) !== null) {
    imports.push({ module: match[1], index: match.index });
  }

  for (const imp of imports) {
    // Check blocked imports first
    if (policy.blockedImports) {
      for (const blocked of policy.blockedImports) {
        if (blocked.test(imp.module)) {
          violations.push({
            type: 'blocked-import',
            message: `Import '${imp.module}' is blocked by security policy`,
            location: getLocation(source, imp.index),
            value: imp.module,
          });
          break;
        }
      }
    }

    // Check if import is in allowed list
    if (policy.allowedImports && policy.allowedImports.length > 0) {
      const isAllowed = policy.allowedImports.some((pattern) => pattern.test(imp.module));
      if (!isAllowed) {
        // Check if already reported as blocked
        const alreadyBlocked = violations.some((v) => v.type === 'blocked-import' && v.value === imp.module);
        if (!alreadyBlocked) {
          violations.push({
            type: 'disallowed-import',
            message: `Import '${imp.module}' is not in the allowed imports list`,
            location: getLocation(source, imp.index),
            value: imp.module,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Validate bundle size against policy.
 *
 * @param size - Bundle size in bytes
 * @param policy - Security policy
 * @returns Violation if size exceeds limit, undefined otherwise
 */
export function validateSize(
  size: number,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
): SecurityViolation | undefined {
  const maxSize = policy.maxBundleSize ?? DEFAULT_SECURITY_POLICY.maxBundleSize ?? 512000;

  if (size > maxSize) {
    return {
      type: 'size-exceeded',
      message: `Bundle size (${formatBytes(size)}) exceeds maximum allowed (${formatBytes(maxSize)})`,
      value: String(size),
    };
  }

  return undefined;
}

/**
 * Create a merged security policy with defaults.
 *
 * @param userPolicy - User-provided policy overrides
 * @returns Merged policy with defaults
 */
export function mergePolicy(userPolicy?: Partial<SecurityPolicy>): SecurityPolicy {
  if (!userPolicy) {
    return { ...DEFAULT_SECURITY_POLICY };
  }

  return {
    allowedImports: userPolicy.allowedImports ?? DEFAULT_SECURITY_POLICY.allowedImports,
    blockedImports: userPolicy.blockedImports ?? DEFAULT_SECURITY_POLICY.blockedImports,
    maxBundleSize: userPolicy.maxBundleSize ?? DEFAULT_SECURITY_POLICY.maxBundleSize,
    maxTransformTime: userPolicy.maxTransformTime ?? DEFAULT_SECURITY_POLICY.maxTransformTime,
    noEval: userPolicy.noEval ?? DEFAULT_SECURITY_POLICY.noEval,
    noDynamicImports: userPolicy.noDynamicImports ?? DEFAULT_SECURITY_POLICY.noDynamicImports,
    noRequire: userPolicy.noRequire ?? DEFAULT_SECURITY_POLICY.noRequire,
    allowedGlobals: userPolicy.allowedGlobals ?? DEFAULT_SECURITY_POLICY.allowedGlobals,
  };
}

/**
 * Get line and column from source index.
 */
function getLocation(source: string, index: number): { line: number; column: number } {
  const lines = source.slice(0, index).split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Security error thrown when policy is violated.
 */
export class SecurityError extends Error {
  readonly violations: SecurityViolation[];

  constructor(message: string, violations: SecurityViolation[]) {
    super(message);
    this.name = 'SecurityError';
    this.violations = violations;
  }
}

/**
 * Throw if any violations exist.
 *
 * @param violations - Array of violations to check
 * @throws SecurityError if violations exist
 */
export function throwOnViolations(violations: SecurityViolation[]): void {
  if (violations.length > 0) {
    const message = violations.map((v) => v.message).join('; ');
    throw new SecurityError(`Security policy violation: ${message}`, violations);
  }
}
