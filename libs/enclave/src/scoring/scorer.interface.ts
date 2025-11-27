/**
 * Scorer Interface
 *
 * Defines the contract that all scorer implementations must follow.
 * This enables a pluggable architecture where different scoring strategies
 * can be swapped without changing the scoring gate logic.
 *
 * @packageDocumentation
 */

import type { ExtractedFeatures, ScoringResult, ScorerType } from './types';

/**
 * Scorer interface - all scorer implementations must implement this
 */
export interface Scorer {
  /**
   * The type of this scorer
   */
  readonly type: ScorerType;

  /**
   * Human-readable name of this scorer
   */
  readonly name: string;

  /**
   * Score the given features and return risk assessment
   *
   * @param features - Extracted features from the code
   * @returns Scoring result with risk score and signals
   */
  score(features: ExtractedFeatures): Promise<ScoringResult>;

  /**
   * Initialize the scorer (e.g., download models, connect to APIs)
   * Optional - only needed for scorers that require setup
   */
  initialize?(): Promise<void>;

  /**
   * Dispose of resources (e.g., unload models, close connections)
   * Optional - only needed for scorers with cleanup requirements
   */
  dispose?(): void;

  /**
   * Check if the scorer is ready to score
   * @returns true if ready, false if initialization is needed
   */
  isReady(): boolean;
}

/**
 * Abstract base class for scorers with common functionality
 */
export abstract class BaseScorer implements Scorer {
  abstract readonly type: ScorerType;
  abstract readonly name: string;

  protected ready = false;

  abstract score(features: ExtractedFeatures): Promise<ScoringResult>;

  async initialize(): Promise<void> {
    this.ready = true;
  }

  dispose(): void {
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Calculate risk level from score
   */
  protected calculateRiskLevel(score: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'none';
  }

  /**
   * Clamp a score to 0-100 range
   */
  protected clampScore(score: number): number {
    return Math.max(0, Math.min(100, score));
  }
}
