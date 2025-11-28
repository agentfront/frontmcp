/**
 * Disabled Scorer
 *
 * Pass-through scorer that always returns zero risk.
 * Use this when scoring is disabled for development/testing.
 *
 * @packageDocumentation
 */

import { BaseScorer } from '../scorer.interface';
import type { ExtractedFeatures, ScoringResult } from '../types';

/**
 * Disabled Scorer - always returns zero risk
 */
export class DisabledScorer extends BaseScorer {
  readonly type = 'disabled' as const;
  readonly name = 'DisabledScorer';

  constructor() {
    super();
    this.ready = true;
  }

  async score(_features: ExtractedFeatures): Promise<ScoringResult> {
    return {
      totalScore: 0,
      riskLevel: 'none',
      signals: [],
      scoringTimeMs: 0,
      scorerType: 'disabled',
    };
  }
}
