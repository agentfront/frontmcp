/**
 * External API Scorer
 *
 * Scorer that calls an external API for advanced detection.
 * Best detection quality but highest latency (~100ms).
 *
 * @packageDocumentation
 */

import { BaseScorer } from '../scorer.interface';
import type { ExtractedFeatures, ScoringResult, ExternalApiConfig, RiskLevel } from '../types';

/**
 * Valid risk levels for API response validation
 */
const VALID_RISK_LEVELS: readonly string[] = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * External API response schema
 */
interface ApiResponse {
  score: number;
  risk?: RiskLevel;
  signals?: Array<{
    id: string;
    score: number;
    description: string;
    level: RiskLevel;
  }>;
  error?: string;
}

/**
 * External API Scorer - calls external API for scoring
 */
export class ExternalApiScorer extends BaseScorer {
  readonly type = 'external-api' as const;
  readonly name = 'ExternalApiScorer';

  private readonly config: Required<ExternalApiConfig>;

  constructor(config: ExternalApiConfig) {
    super();
    this.config = {
      endpoint: config.endpoint,
      apiKey: config.apiKey ?? '',
      timeoutMs: Math.max(0, config.timeoutMs ?? 5000),
      headers: { ...(config.headers ?? {}) },
      retries: Math.max(0, Math.min(10, config.retries ?? 1)),
    };
    this.ready = true;
  }

  async score(features: ExtractedFeatures): Promise<ScoringResult> {
    const startTime = performance.now();

    let lastError: Error | null = null;
    const maxAttempts = this.config.retries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.callApi(features);
        return {
          totalScore: this.clampScore(result.score),
          riskLevel: result.risk ?? this.calculateRiskLevel(result.score),
          signals: (result.signals ?? []).map((s) => ({
            id: s.id,
            score: s.score,
            description: s.description,
            level: s.level,
          })),
          scoringTimeMs: performance.now() - startTime,
          scorerType: 'external-api',
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Wait before retry (exponential backoff)
        if (attempt < maxAttempts - 1) {
          await this.delay(Math.pow(2, attempt) * 100);
        }
      }
    }

    throw new ExternalApiScorerError(
      `Failed to score after ${maxAttempts} attempts: ${lastError?.message}`,
      lastError ?? undefined,
    );
  }

  private async callApi(features: ExtractedFeatures): Promise<ApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`,
          }),
          ...this.config.headers,
        },
        body: JSON.stringify({
          features,
          version: '1.0',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const truncatedBody = body.length > 200 ? body.slice(0, 200) + '...' : body;
        throw new Error(`API returned ${response.status}: ${truncatedBody}`);
      }

      const data = (await response.json()) as ApiResponse;

      if (data.error) {
        throw new Error(`API error: ${data.error}`);
      }

      if (typeof data.score !== 'number') {
        throw new Error('Invalid API response: missing score');
      }

      // Validate risk level if present
      if (data.risk !== undefined && !VALID_RISK_LEVELS.includes(data.risk)) {
        throw new Error(`Invalid API response: invalid risk level "${data.risk}"`);
      }

      // Validate signals array if present
      if (data.signals !== undefined && !Array.isArray(data.signals)) {
        throw new Error('Invalid API response: signals must be an array');
      }

      // Validate signal structure
      if (data.signals !== undefined) {
        for (const signal of data.signals) {
          if (
            typeof signal.id !== 'string' ||
            typeof signal.score !== 'number' ||
            typeof signal.description !== 'string' ||
            typeof signal.level !== 'string'
          ) {
            throw new Error('Invalid API response: signal missing required fields');
          }
          if (!VALID_RISK_LEVELS.includes(signal.level)) {
            throw new Error(`Invalid API response: invalid signal level "${signal.level}"`);
          }
        }
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Error thrown when external API scoring fails
 */
export class ExternalApiScorerError extends Error {
  override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ExternalApiScorerError';
    this.cause = cause;
  }
}
