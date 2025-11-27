/**
 * AI Scoring Gate Module
 *
 * Provides semantic security scoring to detect attack patterns
 * beyond what static AST validation can catch.
 *
 * @example
 * ```typescript
 * import { ScoringGate } from '@frontmcp/enclave';
 *
 * const gate = new ScoringGate({
 *   scorer: 'rule-based',
 *   blockThreshold: 70,
 * });
 *
 * await gate.initialize();
 *
 * const result = await gate.evaluate(code);
 * if (!result.allowed) {
 *   console.log('Blocked:', result.signals);
 * }
 * ```
 *
 * @packageDocumentation
 */

// Main orchestrator
export { ScoringGate, ScoringGateError, createScoringGate } from './scoring-gate';

// Feature extraction
export { FeatureExtractor } from './feature-extractor';

// Cache
export { ScoringCache } from './cache';

// Scorer interface and base class
export { BaseScorer } from './scorer.interface';
export type { Scorer } from './scorer.interface';

// Scorer implementations
export { DisabledScorer, RuleBasedScorer, ExternalApiScorer, ExternalApiScorerError } from './scorers';

// Types
export type {
  // Core types
  ScorerType,
  RiskLevel,
  SensitiveCategory,
  RuleId,

  // Feature types
  ExtractedFeatures,
  ExtractedToolCall,
  PatternSignals,
  NumericSignals,
  SensitiveAccess,
  ExtractionMeta,

  // Scoring types
  RiskSignal,
  ScoringResult,
  ScoringGateResult,

  // Configuration types
  ScoringGateConfig,
  ScoringCacheConfig,
  LocalLlmConfig,
  ExternalApiConfig,
} from './types';

// Constants
export { DEFAULT_SCORING_CONFIG, RULE_THRESHOLDS } from './types';
