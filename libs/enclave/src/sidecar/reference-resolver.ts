/**
 * Reference Resolver - Resolves reference IDs at callTool boundary
 *
 * The Reference Resolver scans callTool arguments for reference IDs
 * and replaces them with actual data from the sidecar. It includes
 * predictive expansion checking to prevent memory exhaustion attacks.
 *
 * @packageDocumentation
 */

import { ReferenceSidecar, SidecarLimitError } from './reference-sidecar';
import { ReferenceConfig, isReferenceId } from './reference-config';

/**
 * Error thrown when resolution limits are exceeded
 */
export class ResolutionLimitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(message);
    this.name = 'ResolutionLimitError';
    Object.setPrototypeOf(this, ResolutionLimitError.prototype);
  }
}

/**
 * Composite handle structure
 *
 * When allowComposites is true, concatenating references produces
 * a composite handle instead of materializing the data.
 */
export interface CompositeHandle {
  __type: 'composite';
  __operation: 'concat';
  __parts: string[];
  __estimatedSize: number;
}

/**
 * Check if a value is a composite handle
 */
export function isCompositeHandle(value: unknown): value is CompositeHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any).__type === 'composite' &&
    Array.isArray((value as any).__parts)
  );
}

/**
 * Reference Resolver
 *
 * Resolves reference IDs to actual data at the callTool boundary.
 * Performs predictive expansion checking before allocation.
 *
 * @example
 * ```typescript
 * const resolver = new ReferenceResolver(sidecar, config);
 *
 * // Check if resolution would exceed limits
 * const size = resolver.predictExpandedSize(args);
 * if (size > config.maxResolvedSize) {
 *   throw new Error('Arguments too large');
 * }
 *
 * // Resolve all references
 * const resolvedArgs = resolver.resolve(args);
 * ```
 */
export class ReferenceResolver {
  constructor(private readonly sidecar: ReferenceSidecar, private readonly config: ReferenceConfig) {}

  /**
   * Predict the expanded size of a value WITHOUT allocating memory
   *
   * This calculates the total size if all references were resolved,
   * enabling fail-fast before any memory allocation occurs.
   *
   * @param value - The value to analyze
   * @param depth - Current recursion depth (internal)
   * @returns Estimated size in bytes
   * @throws ResolutionLimitError if depth limit exceeded
   */
  predictExpandedSize(value: unknown, depth = 0): number {
    // Check depth limit
    if (depth > this.config.maxResolutionDepth) {
      throw new ResolutionLimitError(
        `Maximum resolution depth exceeded (${this.config.maxResolutionDepth})`,
        'MAX_RESOLUTION_DEPTH',
        this.config.maxResolutionDepth,
        depth,
      );
    }

    // Handle reference IDs
    if (isReferenceId(value)) {
      const size = this.sidecar.getSize(value);
      if (size === undefined) {
        // Reference not found - use ID length as fallback
        return value.length;
      }
      return size;
    }

    // Handle composite handles
    if (isCompositeHandle(value)) {
      return value.__parts.reduce((sum, part) => {
        return sum + this.predictExpandedSize(part, depth + 1);
      }, 0);
    }

    // Handle strings (not references)
    if (typeof value === 'string') {
      return Buffer.byteLength(value, 'utf-8');
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => {
        return sum + this.predictExpandedSize(item, depth + 1);
      }, 0);
    }

    // Handle objects
    if (value !== null && typeof value === 'object') {
      return Object.values(value).reduce((sum: number, val) => {
        return sum + this.predictExpandedSize(val, depth + 1);
      }, 0);
    }

    // Primitives have minimal size
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 1;
    if (value === null || value === undefined) return 0;

    return 0;
  }

  /**
   * Check if resolution would exceed size limits
   *
   * @param value - The value to check
   * @returns true if resolution would exceed maxResolvedSize
   */
  wouldExceedLimit(value: unknown): boolean {
    try {
      const size = this.predictExpandedSize(value);
      return size > this.config.maxResolvedSize;
    } catch {
      return true; // Treat errors as exceeding limit
    }
  }

  /**
   * Resolve all reference IDs in a value tree
   *
   * Recursively walks the value and replaces reference IDs with
   * their actual data from the sidecar.
   *
   * @param value - The value to resolve
   * @param depth - Current recursion depth (internal)
   * @returns The resolved value with references replaced
   * @throws ResolutionLimitError if limits exceeded
   * @throws ReferenceNotFoundError if a reference doesn't exist
   */
  resolve(value: unknown, depth = 0): unknown {
    // Check depth limit
    if (depth > this.config.maxResolutionDepth) {
      throw new ResolutionLimitError(
        `Maximum resolution depth exceeded during resolution (${this.config.maxResolutionDepth})`,
        'MAX_RESOLUTION_DEPTH',
        this.config.maxResolutionDepth,
        depth,
      );
    }

    // Handle reference IDs
    if (isReferenceId(value)) {
      const data = this.sidecar.retrieveString(value);
      if (data === undefined) {
        throw new Error(`Unknown reference: ${value}`);
      }
      return data;
    }

    // Handle composite handles
    if (isCompositeHandle(value)) {
      return this.resolveComposite(value, depth);
    }

    // Handle strings (not references) - pass through
    if (typeof value === 'string') {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.resolve(item, depth + 1));
    }

    // Handle objects
    if (value !== null && typeof value === 'object') {
      const resolved: Record<string, unknown> = Object.create(null);
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolve(val, depth + 1);
      }
      return resolved;
    }

    // Primitives pass through
    return value;
  }

  /**
   * Resolve a composite handle by concatenating its parts
   */
  private resolveComposite(handle: CompositeHandle, depth: number): string {
    const parts: string[] = [];

    for (const part of handle.__parts) {
      const resolved = this.resolve(part, depth + 1);
      if (typeof resolved !== 'string') {
        throw new Error(`Composite part resolved to non-string: ${typeof resolved}`);
      }
      parts.push(resolved);
    }

    return parts.join('');
  }

  /**
   * Check if a value contains any reference IDs
   *
   * @param value - The value to check
   * @param depth - Current recursion depth (internal)
   * @returns true if the value or any nested value is a reference
   */
  containsReferences(value: unknown, depth = 0): boolean {
    if (depth > this.config.maxResolutionDepth) {
      return false;
    }

    if (isReferenceId(value) || isCompositeHandle(value)) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.some((item) => this.containsReferences(item, depth + 1));
    }

    if (value !== null && typeof value === 'object') {
      return Object.values(value).some((val) => this.containsReferences(val, depth + 1));
    }

    return false;
  }

  /**
   * Create a composite handle from multiple reference parts
   *
   * Used by __safe_concat__ when allowComposites is true.
   *
   * @param parts - Reference IDs or strings to combine
   * @returns A composite handle or the concatenated string
   * @throws Error if composites not allowed or limits exceeded
   */
  createComposite(parts: string[]): CompositeHandle | string {
    // Check if any parts are references
    const hasReferences = parts.some((p) => isReferenceId(p));

    if (!hasReferences) {
      // No references - just concatenate normally
      return parts.join('');
    }

    // Check if composites are allowed
    if (!this.config.allowComposites) {
      throw new Error(
        'Cannot concatenate reference IDs. Pass references directly to callTool arguments. ' +
          'Composite handles are disabled in the current security configuration.',
      );
    }

    // Calculate estimated size
    const estimatedSize = parts.reduce((sum, part) => {
      if (isReferenceId(part)) {
        return sum + (this.sidecar.getSize(part) ?? part.length);
      }
      return sum + Buffer.byteLength(part, 'utf-8');
    }, 0);

    // Check against limits
    if (estimatedSize > this.config.maxResolvedSize) {
      throw new ResolutionLimitError(
        `Composite would exceed maximum resolved size: ${estimatedSize} > ${this.config.maxResolvedSize}`,
        'MAX_RESOLVED_SIZE',
        this.config.maxResolvedSize,
        estimatedSize,
      );
    }

    return {
      __type: 'composite',
      __operation: 'concat',
      __parts: parts,
      __estimatedSize: estimatedSize,
    };
  }
}
