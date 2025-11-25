/**
 * AST Guard Presets - Pre-configured security levels
 *
 * Security levels (high → low):
 * - STRICT: Maximum security (bank-grade)
 * - SECURE: High security with flexibility
 * - STANDARD: Balanced security
 * - PERMISSIVE: Minimal restrictions
 *
 * @packageDocumentation
 */

// Types
export { PresetOptions, PresetLevel } from './types';

// Individual presets
export { createStrictPreset } from './strict.preset';
export { createSecurePreset } from './secure.preset';
export { createStandardPreset } from './standard.preset';
export { createPermissivePreset } from './permissive.preset';
export { createAgentScriptPreset, type AgentScriptOptions } from './agentscript.preset';

// Re-export for convenience
import { ValidationRule } from '../interfaces';
import { ConfigurationError } from '../errors';
import { PresetLevel, PresetOptions } from './types';
import { createStrictPreset } from './strict.preset';
import { createSecurePreset } from './secure.preset';
import { createStandardPreset } from './standard.preset';
import { createPermissivePreset } from './permissive.preset';

/**
 * Creates a preset based on the specified level
 *
 * @param level - The preset level to create
 * @param options - Optional customization for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * import { createPreset, PresetLevel } from 'ast-guard';
 *
 * // Create a strict preset (bank-grade)
 * const rules = createPreset(PresetLevel.STRICT);
 *
 * // Create a standard preset with custom options
 * const rules = createPreset(PresetLevel.STANDARD, {
 *   requiredFunctions: ['callTool'],
 *   additionalDisallowedIdentifiers: ['window', 'document']
 * });
 * ```
 */
export function createPreset(level: PresetLevel, options: PresetOptions = {}): ValidationRule[] {
  switch (level) {
    case PresetLevel.STRICT:
      return createStrictPreset(options);
    case PresetLevel.SECURE:
      return createSecurePreset(options);
    case PresetLevel.STANDARD:
      return createStandardPreset(options);
    case PresetLevel.PERMISSIVE:
      return createPermissivePreset(options);
    default:
      throw new ConfigurationError(`Unknown preset level: ${level}`);
  }
}

/**
 * Convenience object with all preset factory functions
 *
 * Security levels (high → low):
 * - strict: Maximum security (bank-grade)
 * - secure: High security with flexibility
 * - standard: Balanced security
 * - permissive: Minimal restrictions
 *
 * @example
 * ```typescript
 * import { Presets } from 'ast-guard';
 *
 * // Create presets using the Presets object
 * const strictRules = Presets.strict();
 * const secureRules = Presets.secure({ requiredFunctions: ['callTool'] });
 * const standardRules = Presets.standard();
 * ```
 */
export const Presets = {
  /** Creates a strict preset (maximum security, bank-grade) */
  strict: createStrictPreset,
  /** Creates a secure preset (high security) */
  secure: createSecurePreset,
  /** Creates a standard preset (balanced security) */
  standard: createStandardPreset,
  /** Creates a permissive preset (minimal restrictions) */
  permissive: createPermissivePreset,
  /** Creates a preset by level */
  create: createPreset,
} as const;
