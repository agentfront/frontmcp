// common/types/options/elicitation/index.ts
// Barrel export for elicitation options

// ============================================
// EXPLICIT INTERFACES (for better autocomplete)
// ============================================
export type { ElicitationOptionsInterface } from './interfaces';

// ============================================
// SCHEMAS & DEFAULTS
// ============================================
export { elicitationOptionsSchema, DEFAULT_ELICITATION_OPTIONS } from './schema';

// ============================================
// TYPE EXPORTS
// ============================================
export type { ElicitationOptions, ElicitationOptionsInput } from './schema';
