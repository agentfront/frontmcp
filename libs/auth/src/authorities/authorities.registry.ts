/**
 * Authority Registries
 *
 * - AuthoritiesProfileRegistry: stores named authority profiles
 * - AuthoritiesEvaluatorRegistry: stores custom evaluators
 */

import type {
  AuthoritiesPolicyMetadata,
  AuthoritiesEvaluator,
} from './authorities.types';

// ============================================
// Profile Registry
// ============================================

/**
 * Registry for named authority profiles.
 * Profiles map a string name to a policy, allowing
 * `authorities: 'admin'` shorthand in decorators.
 */
export class AuthoritiesProfileRegistry {
  private readonly profiles = new Map<string, AuthoritiesPolicyMetadata>();

  /**
   * Register a named profile.
   * Overwrites any existing profile with the same name.
   */
  register(name: string, policy: AuthoritiesPolicyMetadata): void {
    this.profiles.set(name, policy);
  }

  /**
   * Register multiple profiles at once.
   */
  registerAll(profiles: Record<string, AuthoritiesPolicyMetadata>): void {
    for (const [name, policy] of Object.entries(profiles)) {
      this.profiles.set(name, policy);
    }
  }

  /**
   * Resolve a profile name to its policy.
   * Returns `undefined` if the profile is not registered.
   */
  resolve(name: string): AuthoritiesPolicyMetadata | undefined {
    return this.profiles.get(name);
  }

  /**
   * Check if a profile is registered.
   */
  has(name: string): boolean {
    return this.profiles.has(name);
  }

  /**
   * Get all registered profiles.
   */
  getAll(): Record<string, AuthoritiesPolicyMetadata> {
    const result: Record<string, AuthoritiesPolicyMetadata> = {};
    for (const [name, policy] of this.profiles) {
      result[name] = policy;
    }
    return result;
  }

  /**
   * Get the number of registered profiles.
   */
  get size(): number {
    return this.profiles.size;
  }

  /**
   * Remove a profile by name.
   */
  remove(name: string): boolean {
    return this.profiles.delete(name);
  }

  /**
   * Clear all profiles.
   */
  clear(): void {
    this.profiles.clear();
  }
}

// ============================================
// Custom Evaluator Registry
// ============================================

/**
 * Registry for custom authority evaluators.
 * Custom evaluators handle the `custom.*` field in policies.
 */
export class AuthoritiesEvaluatorRegistry {
  private readonly evaluators = new Map<string, AuthoritiesEvaluator>();

  /**
   * Register a custom evaluator.
   * The evaluator's name must match the key used in `custom.*`.
   */
  register(name: string, evaluator: AuthoritiesEvaluator): void {
    this.evaluators.set(name, evaluator);
  }

  /**
   * Register multiple evaluators at once.
   */
  registerAll(evaluators: Record<string, AuthoritiesEvaluator>): void {
    for (const [name, evaluator] of Object.entries(evaluators)) {
      this.evaluators.set(name, evaluator);
    }
  }

  /**
   * Get an evaluator by name.
   */
  get(name: string): AuthoritiesEvaluator | undefined {
    return this.evaluators.get(name);
  }

  /**
   * Check if an evaluator is registered.
   */
  has(name: string): boolean {
    return this.evaluators.has(name);
  }

  /**
   * Get the number of registered evaluators.
   */
  get size(): number {
    return this.evaluators.size;
  }

  /**
   * Remove an evaluator by name.
   */
  remove(name: string): boolean {
    return this.evaluators.delete(name);
  }

  /**
   * Clear all evaluators.
   */
  clear(): void {
    this.evaluators.clear();
  }
}
