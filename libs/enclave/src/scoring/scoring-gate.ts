/**
 * Scoring Gate
 *
 * Main orchestrator for the AI scoring system. Handles:
 * - Feature extraction from code
 * - Scorer selection and initialization
 * - Result caching
 * - Decision making (allow/warn/block)
 *
 * @packageDocumentation
 */

import type { Scorer } from './scorer.interface';
import { FeatureExtractor } from './feature-extractor';
import { ScoringCache } from './cache';
import { DisabledScorer, RuleBasedScorer, ExternalApiScorer, ProgressiveScorer, LocalLlmScorer } from './scorers';
import type {
  ScoringGateConfig,
  ScoringGateResult,
  ScorerType,
  ExtractedFeatures,
  NormalizedScoringConfig,
} from './types';
import { DEFAULT_SCORING_CONFIG, normalizeScoringConfig } from './types';

/**
 * Scoring Gate - orchestrates the AI scoring system
 */
export class ScoringGate {
  private readonly extractor: FeatureExtractor;
  private readonly config: NormalizedScoringConfig;
  private scorer: Scorer | null = null;
  private cache: ScoringCache | null = null;
  private initialized = false;

  constructor(config: ScoringGateConfig) {
    this.extractor = new FeatureExtractor();

    // Normalize configuration (handles both legacy and new progressive mode)
    this.config = normalizeScoringConfig(config);

    // Initialize cache if enabled
    if (this.config.cache.enabled && this.config.scorerType !== 'disabled') {
      this.cache = new ScoringCache(this.config.cache);
    }
  }

  /**
   * Initialize the scoring gate
   *
   * Must be called before evaluate() for scorers that require initialization
   * (e.g., local-llm needs to download the model)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create the scorer
    this.scorer = this.createScorer();

    // Initialize the scorer (may download models, etc.)
    await this.scorer.initialize?.();

    this.initialized = true;
  }

  /**
   * Create the appropriate scorer based on configuration
   */
  private createScorer(): Scorer {
    switch (this.config.scorerType) {
      case 'disabled':
        return new DisabledScorer();

      case 'rule-based':
        return new RuleBasedScorer(this.config.customRules);

      case 'local-llm':
        if (!this.config.localLlm) {
          if (this.config.verbose) {
            console.warn('[ScoringGate] local-llm scorer requires localLlm config, using rule-based fallback');
          }
          return new RuleBasedScorer(this.config.customRules);
        }
        return new LocalLlmScorer(this.config.localLlm);

      case 'external-api':
        if (!this.config.externalApi) {
          throw new ScoringGateError('external-api scorer requires externalApi configuration');
        }
        return new ExternalApiScorer(this.config.externalApi);

      case 'progressive':
        if (!this.config.progressiveConfig) {
          throw new ScoringGateError('progressive scorer requires scoring configuration');
        }
        return new ProgressiveScorer(this.config.progressiveConfig);

      default:
        throw new ScoringGateError(`Unknown scorer type: ${this.config.scorerType}`);
    }
  }

  /**
   * Evaluate code for security risks
   *
   * @param code - Source code to evaluate
   * @returns Scoring gate result with allow/warn/block decision
   */
  async evaluate(code: string): Promise<ScoringGateResult> {
    const startTime = performance.now();

    // Disabled mode - always allow
    if (this.config.scorerType === 'disabled') {
      return {
        allowed: true,
        reason: 'Scoring disabled',
        latencyMs: performance.now() - startTime,
        cached: false,
      };
    }

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.scorer) {
      throw new ScoringGateError('Scorer not initialized');
    }

    try {
      // Extract features
      const extractionStart = performance.now();
      const features = this.extractor.extract(code);
      const extractionTimeMs = performance.now() - extractionStart;

      // Check cache
      if (this.cache) {
        const cached = this.cache.get(features.meta.codeHash);
        if (cached) {
          const allowed = cached.totalScore < this.config.blockThreshold;
          const warned = cached.totalScore >= this.config.warnThreshold;

          if (this.config.verbose) {
            console.log(`[ScoringGate] Cache hit: score=${cached.totalScore}`);
          }

          return {
            allowed,
            warned,
            totalScore: cached.totalScore,
            riskLevel: cached.riskLevel,
            signals: cached.signals,
            latencyMs: performance.now() - startTime,
            cached: true,
          };
        }
      }

      // Run scorer
      const scoringStart = performance.now();
      const result = await this.scorer.score(features);
      const scoringTimeMs = performance.now() - scoringStart;

      // Cache result
      if (this.cache) {
        this.cache.set(features.meta.codeHash, result);
      }

      // Make decision
      const allowed = result.totalScore < this.config.blockThreshold;
      const warned = result.totalScore >= this.config.warnThreshold && allowed;

      if (this.config.verbose) {
        console.log(
          `[ScoringGate] Score: ${result.totalScore} (${result.riskLevel}), ` +
            `allowed: ${allowed}, warned: ${warned}`,
        );
        if (result.signals.length > 0) {
          for (const signal of result.signals) {
            console.log(`  - ${signal.id}: ${signal.score} (${signal.level}): ${signal.description}`);
          }
        }
      }

      return {
        allowed,
        warned,
        totalScore: result.totalScore,
        riskLevel: result.riskLevel,
        signals: result.signals,
        latencyMs: performance.now() - startTime,
        cached: false,
        extractionTimeMs,
        scoringTimeMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.config.verbose) {
        console.error(`[ScoringGate] Error: ${errorMessage}`);
      }

      // Fail-open or fail-closed
      if (this.config.failOpen) {
        return {
          allowed: true,
          reason: `Scoring error (fail-open): ${errorMessage}`,
          latencyMs: performance.now() - startTime,
          cached: false,
        };
      }

      return {
        allowed: false,
        reason: `Scoring error (fail-closed): ${errorMessage}`,
        latencyMs: performance.now() - startTime,
        cached: false,
      };
    }
  }

  /**
   * Get the current scorer type
   */
  getScorerType(): ScorerType {
    return this.config.scorerType;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): ReturnType<ScoringCache['getStats']> | null {
    return this.cache?.getStats() ?? null;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache?.clear();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.scorer?.dispose?.();
    this.cache?.clear();
    this.scorer = null;
    this.cache = null;
    this.initialized = false;
  }

  /**
   * Check if the gate is ready to evaluate
   */
  isReady(): boolean {
    return this.initialized && (this.scorer?.isReady() ?? false);
  }

  /**
   * Get the effective configuration
   */
  getConfig(): Readonly<typeof this.config> {
    return this.config;
  }
}

/**
 * Error thrown by the scoring gate
 */
export class ScoringGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringGateError';
  }
}

/**
 * Factory function to create a scoring gate
 */
export function createScoringGate(config: ScoringGateConfig): ScoringGate {
  return new ScoringGate(config);
}
