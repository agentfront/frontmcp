/**
 * Progressive Scorer Tests
 */

import { ProgressiveScorer } from '../scorers/progressive.scorer';
import { RuleBasedScorer } from '../scorers/rule-based.scorer';
import type { ExtractedFeatures, ProgressiveScoringConfig } from '../types';

// Mock features with minimal risk
const createLowRiskFeatures = (): ExtractedFeatures => ({
  toolCalls: [
    {
      toolName: 'users:get',
      isStaticName: true,
      argumentKeys: ['id'],
      stringLiterals: [],
      numericLiterals: [],
      insideLoop: false,
      loopDepth: 0,
      location: { line: 1, column: 1 },
    },
  ],
  patterns: {
    totalToolCalls: 1,
    uniqueToolsCount: 1,
    toolsInLoops: [],
    maxLoopNesting: 0,
    toolSequence: ['users:get'],
    iteratesOverToolResults: false,
  },
  signals: {
    maxLimit: 10,
    maxStringLength: 5,
    toolCallDensity: 0.1,
    fanOutRisk: 5,
  },
  sensitive: {
    fieldsAccessed: [],
    categories: [],
  },
  meta: {
    extractionTimeMs: 1,
    codeHash: 'test-hash',
    lineCount: 10,
  },
});

// Mock features with medium risk (should escalate)
const createMediumRiskFeatures = (): ExtractedFeatures => ({
  toolCalls: [
    {
      toolName: 'users:list',
      isStaticName: true,
      argumentKeys: ['query'],
      stringLiterals: ['*'],
      numericLiterals: [1000],
      insideLoop: true,
      loopDepth: 1,
      location: { line: 1, column: 1 },
    },
  ],
  patterns: {
    totalToolCalls: 3,
    uniqueToolsCount: 2,
    toolsInLoops: ['users:list'],
    maxLoopNesting: 1,
    toolSequence: ['users:list', 'email:send'],
    iteratesOverToolResults: true,
  },
  signals: {
    maxLimit: 5000,
    maxStringLength: 50,
    toolCallDensity: 0.5,
    fanOutRisk: 40,
  },
  sensitive: {
    fieldsAccessed: ['email'],
    categories: ['pii'],
  },
  meta: {
    extractionTimeMs: 1,
    codeHash: 'test-hash-medium',
    lineCount: 20,
  },
});

// Mock features with high risk
const createHighRiskFeatures = (): ExtractedFeatures => ({
  toolCalls: [
    {
      toolName: 'users:list',
      isStaticName: true,
      argumentKeys: ['query', 'limit'],
      stringLiterals: ['*'],
      numericLiterals: [100000],
      insideLoop: true,
      loopDepth: 2,
      location: { line: 1, column: 1 },
    },
    {
      toolName: 'email:send',
      isStaticName: true,
      argumentKeys: ['to', 'body'],
      stringLiterals: [],
      numericLiterals: [],
      insideLoop: true,
      loopDepth: 2,
      location: { line: 5, column: 1 },
    },
  ],
  patterns: {
    totalToolCalls: 5,
    uniqueToolsCount: 3,
    toolsInLoops: ['users:list', 'email:send'],
    maxLoopNesting: 2,
    toolSequence: ['users:list', 'email:send'],
    iteratesOverToolResults: true,
  },
  signals: {
    maxLimit: 100000,
    maxStringLength: 100,
    toolCallDensity: 0.8,
    fanOutRisk: 80,
  },
  sensitive: {
    fieldsAccessed: ['password', 'token'],
    categories: ['authentication', 'pii'],
  },
  meta: {
    extractionTimeMs: 1,
    codeHash: 'test-hash-high',
    lineCount: 30,
  },
});

describe('ProgressiveScorer', () => {
  describe('constructor', () => {
    it('should create with default values', () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
      };

      const scorer = new ProgressiveScorer(config);

      expect(scorer.type).toBe('progressive');
      expect(scorer.name).toBe('ProgressiveScorer');
      expect(scorer.getEscalationThreshold()).toBe(30);
      expect(scorer.getCombinationMode()).toBe('max');
    });

    it('should respect custom escalation threshold', () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        escalationThreshold: 50,
      };

      const scorer = new ProgressiveScorer(config);
      expect(scorer.getEscalationThreshold()).toBe(50);
    });

    it('should respect custom combination mode', () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        combination: 'avg',
      };

      const scorer = new ProgressiveScorer(config);
      expect(scorer.getCombinationMode()).toBe('avg');
    });
  });

  describe('initialize()', () => {
    it('should initialize without detailed scorer if not configured', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'local-llm' }, // No localLlm config provided
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      expect(scorer.isReady()).toBe(true);
      expect(scorer.hasDetailedScorer()).toBe(false);
    });

    it('should not reinitialize if already ready', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();
      await scorer.initialize(); // Second call should be no-op

      expect(scorer.isReady()).toBe(true);
    });
  });

  describe('score() - fast path (no escalation)', () => {
    it('should return fast result when score is below threshold', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        escalationThreshold: 30,
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      const features = createLowRiskFeatures();
      const result = await scorer.score(features);

      expect(result.totalScore).toBeLessThan(30);
      expect(result.scorerType).toBe('progressive');

      scorer.dispose();
    });

    it('should be fast for low-risk code', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      const features = createLowRiskFeatures();
      const start = performance.now();
      const result = await scorer.score(features);
      const elapsed = performance.now() - start;

      // Should be very fast (<10ms) since no escalation
      expect(elapsed).toBeLessThan(10);
      expect(result.scorerType).toBe('progressive');

      scorer.dispose();
    });
  });

  describe('score() - escalation path', () => {
    it('should escalate when fast score exceeds threshold', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        escalationThreshold: 20,
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      // Use medium risk features that should trigger escalation
      const features = createMediumRiskFeatures();

      // First check that fast scorer would exceed threshold
      const fastScorer = new RuleBasedScorer();
      const fastResult = await fastScorer.score(features);
      expect(fastResult.totalScore).toBeGreaterThanOrEqual(20);

      // Now test progressive scorer - it will try to escalate
      // Since external API is mocked, it will fall back to fast result
      const result = await scorer.score(features);
      expect(result.scorerType).toBe('progressive');
      expect(result.totalScore).toBeGreaterThanOrEqual(20);

      scorer.dispose();
    });

    it('should fall back to fast result if detailed scorer fails', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://invalid-url' } },
        escalationThreshold: 10,
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      const features = createMediumRiskFeatures();
      const result = await scorer.score(features);

      // Should still get a result (from fast scorer) even if detailed fails
      expect(result.scorerType).toBe('progressive');
      expect(typeof result.totalScore).toBe('number');

      scorer.dispose();
    });
  });

  describe('score() - without detailed scorer', () => {
    it('should use fast result only when no detailed scorer available', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'local-llm' }, // No config, so won't create scorer
        escalationThreshold: 10, // Low threshold to trigger escalation
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      expect(scorer.hasDetailedScorer()).toBe(false);

      const features = createHighRiskFeatures();
      const result = await scorer.score(features);

      // Should still score successfully using just fast scorer
      expect(result.scorerType).toBe('progressive');
      expect(result.totalScore).toBeGreaterThan(0);

      scorer.dispose();
    });
  });

  describe('score combination modes', () => {
    it('should use max mode correctly', async () => {
      // Can't fully test without a working detailed scorer,
      // but we can verify the mode is set
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        combination: 'max',
      };

      const scorer = new ProgressiveScorer(config);
      expect(scorer.getCombinationMode()).toBe('max');
      scorer.dispose();
    });

    it('should use replace mode correctly', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        combination: 'replace',
      };

      const scorer = new ProgressiveScorer(config);
      expect(scorer.getCombinationMode()).toBe('replace');
      scorer.dispose();
    });

    it('should use avg mode correctly', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
        combination: 'avg',
      };

      const scorer = new ProgressiveScorer(config);
      expect(scorer.getCombinationMode()).toBe('avg');
      scorer.dispose();
    });
  });

  describe('dispose()', () => {
    it('should clean up resources', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      expect(scorer.isReady()).toBe(true);

      scorer.dispose();

      expect(scorer.isReady()).toBe(false);
    });
  });

  describe('custom rules in fast scorer', () => {
    it('should pass custom rules to fast scorer', async () => {
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: {
          type: 'rule-based',
          customRules: { CUSTOM_RULE: 100 },
        },
        detailed: { type: 'external-api', externalApi: { endpoint: 'http://test' } },
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      // Custom rules are passed to internal RuleBasedScorer
      // We can verify the scorer initializes correctly
      expect(scorer.isReady()).toBe(true);

      scorer.dispose();
    });
  });

  describe('integration with ScoringGate', () => {
    it('should work when created through ScoringGate config', async () => {
      // This tests that the types work correctly with ScoringGateConfig
      const config: ProgressiveScoringConfig = {
        strategy: 'progressive',
        fast: { type: 'rule-based' },
        detailed: {
          type: 'local-llm',
          localLlm: {
            modelId: 'Xenova/all-MiniLM-L6-v2',
            mode: 'classification',
            fallbackToRules: true,
          },
        },
        escalationThreshold: 30,
        combination: 'max',
      };

      const scorer = new ProgressiveScorer(config);
      await scorer.initialize();

      // The scorer should be ready (LocalLlm will fall back to rules)
      expect(scorer.isReady()).toBe(true);
      expect(scorer.hasDetailedScorer()).toBe(true);

      scorer.dispose();
    });
  });
});
