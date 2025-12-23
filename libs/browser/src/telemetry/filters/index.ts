// file: libs/browser/src/telemetry/filters/index.ts
/**
 * PII Filters Module
 *
 * Privacy-preserving filters for telemetry data.
 */

// Filter chain
export {
  createPiiFilterChain,
  applyPattern,
  deepApplyPatterns,
  createPatternFilter,
  composePiiFilters,
} from './pii-filter-chain';

// Built-in patterns
export {
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
  BUILTIN_PATTERNS,
  getBuiltinPattern,
  getBuiltinPatterns,
  getPatternNames,
} from './built-in-patterns';

// Built-in filter plugin
export {
  createBuiltInPiiFilter,
  createCategoryPiiFilter,
  type BuiltInPiiFilterOptions,
} from './built-in-filter.plugin';

// Custom filter plugins
export {
  createPiiFilterPlugin,
  createMultiPatternFilter,
  createFieldRemovalFilter,
  createConditionalFilter,
  type PiiFilterPluginOptions,
  type MultiPatternFilterOptions,
} from './pii-filter.plugin';
