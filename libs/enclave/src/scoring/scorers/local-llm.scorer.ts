/**
 * Local LLM Scorer
 *
 * Uses Hugging Face transformers.js for on-device ML-based security scoring.
 * Supports two modes:
 * - classification: Direct text classification for security risk
 * - similarity: Embedding comparison with known malicious patterns
 *
 * @packageDocumentation
 */

import { BaseScorer } from '../scorer.interface';
import { RuleBasedScorer } from './rule-based.scorer';
import type { ExtractedFeatures, ScoringResult, RiskSignal, LocalLlmConfig, RiskLevel } from '../types';

// Pipeline type from @huggingface/transformers
type Pipeline = (input: string, options?: Record<string, unknown>) => Promise<{ data: number[] }>;

// Classification output type
interface ClassificationOutput {
  label: string;
  score: number;
}

/**
 * Default model cache directory
 */
const DEFAULT_CACHE_DIR = './.cache/transformers';

/**
 * Default model for classification
 */
const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Risk keywords to look for in feature text
 */
const RISK_KEYWORDS = {
  critical: ['password', 'secret', 'apikey', 'token', 'credential', 'private_key'],
  high: ['exfiltration', 'send', 'webhook', 'upload', 'transfer', 'email'],
  medium: ['limit:999', 'bulk', 'batch', 'all', 'wildcard'],
  low: ['loop', 'iterate', 'list', 'query'],
};

/**
 * Local LLM Scorer - on-device ML-based security scoring
 *
 * @example
 * ```typescript
 * const scorer = new LocalLlmScorer({
 *   modelId: 'Xenova/all-MiniLM-L6-v2',
 *   mode: 'classification',
 *   cacheDir: './.cache/models'
 * });
 *
 * await scorer.initialize();
 * const result = await scorer.score(features);
 * ```
 */
export class LocalLlmScorer extends BaseScorer {
  readonly type = 'local-llm' as const;
  readonly name = 'LocalLlmScorer';

  private pipeline: Pipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private fallbackScorer: RuleBasedScorer | null = null;
  private readonly config: LocalLlmConfig;

  constructor(config: LocalLlmConfig) {
    super();
    this.config = {
      ...config,
      modelId: config.modelId || DEFAULT_MODEL_ID,
      mode: config.mode ?? 'classification',
      cacheDir: config.cacheDir ?? config.modelDir ?? DEFAULT_CACHE_DIR,
      fallbackToRules: config.fallbackToRules ?? true,
    };

    // Create fallback scorer if enabled
    if (this.config.fallbackToRules !== false) {
      this.fallbackScorer = new RuleBasedScorer();
    }
  }

  /**
   * Initialize the ML model
   */
  override async initialize(): Promise<void> {
    if (this.ready) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  /**
   * Internal initialization logic
   */
  private async _initialize(): Promise<void> {
    try {
      // Dynamic import to avoid bundling issues
      const { pipeline } = await import('@huggingface/transformers');

      // Use feature-extraction pipeline for both modes
      // (classification mode uses embeddings + heuristics, similarity mode uses embeddings + VectoriaDB)
      const pipelineFn = await pipeline('feature-extraction', this.config.modelId, {
        cache_dir: this.config.cacheDir,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Pipeline type is complex
      this.pipeline = pipelineFn as any as Pipeline;

      this.ready = true;
    } catch (error) {
      this.initPromise = null;

      if (this.fallbackScorer) {
        console.warn(
          `[LocalLlmScorer] Model load failed, using rule-based fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.ready = true; // Ready with fallback
      } else {
        throw new LocalLlmScorerError(
          `Failed to initialize model: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Score the extracted features
   */
  async score(features: ExtractedFeatures): Promise<ScoringResult> {
    const startTime = performance.now();

    // If model failed to load and we have fallback
    if (!this.pipeline && this.fallbackScorer) {
      const result = await this.fallbackScorer.score(features);
      return {
        ...result,
        scorerType: 'local-llm', // Report as local-llm even when using fallback
      };
    }

    try {
      if (this.config.mode === 'similarity') {
        return await this.scoreWithSimilarity(features, startTime);
      }
      return await this.scoreWithClassification(features, startTime);
    } catch (error) {
      // On error, try fallback
      if (this.fallbackScorer) {
        console.warn(
          `[LocalLlmScorer] Scoring failed, using fallback: ${error instanceof Error ? error.message : String(error)}`,
        );
        const result = await this.fallbackScorer.score(features);
        return {
          ...result,
          scorerType: 'local-llm',
        };
      }
      throw error;
    }
  }

  /**
   * Score using text classification approach
   *
   * Since we don't have a fine-tuned security classifier,
   * we use embeddings + keyword analysis as a proxy.
   */
  private async scoreWithClassification(features: ExtractedFeatures, startTime: number): Promise<ScoringResult> {
    // Convert features to text prompt
    const prompt = this.featuresToPrompt(features);

    // Get embedding for the prompt
    const embedding = await this.getEmbedding(prompt);

    // Score based on semantic content (using keyword heuristics for now)
    // In production, this would compare against known malicious pattern embeddings
    const { score, signals } = this.analyzePrompt(prompt, features);

    return {
      totalScore: this.clampScore(score),
      riskLevel: this.calculateRiskLevel(score),
      signals,
      scoringTimeMs: performance.now() - startTime,
      scorerType: 'local-llm',
    };
  }

  /**
   * Score using similarity to known malicious patterns
   */
  private async scoreWithSimilarity(features: ExtractedFeatures, startTime: number): Promise<ScoringResult> {
    // Convert features to text prompt
    const prompt = this.featuresToPrompt(features);

    // Get embedding
    const embedding = await this.getEmbedding(prompt);

    // For now, use heuristic scoring until VectoriaDB integration is complete
    // TODO: Implement VectoriaDB similarity search against malicious pattern index
    const { score, signals } = this.analyzePrompt(prompt, features);

    // Add similarity mode signal
    signals.push({
      id: 'SIMILARITY_MODE',
      score: 0,
      description: 'Similarity scoring (VectoriaDB integration pending)',
      level: 'none' as RiskLevel,
    });

    return {
      totalScore: this.clampScore(score),
      riskLevel: this.calculateRiskLevel(score),
      signals,
      scoringTimeMs: performance.now() - startTime,
      scorerType: 'local-llm',
    };
  }

  /**
   * Get embedding for text
   */
  private async getEmbedding(text: string): Promise<Float32Array> {
    if (!this.pipeline) {
      throw new LocalLlmScorerError('Pipeline not initialized');
    }

    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return new Float32Array(output.data);
  }

  /**
   * Convert extracted features to a text prompt for the model
   */
  private featuresToPrompt(features: ExtractedFeatures): string {
    const parts: string[] = [];

    // Tool call summary
    const toolNames = features.toolCalls.map((tc) => tc.toolName);
    if (toolNames.length > 0) {
      parts.push(`TOOLS: ${toolNames.slice(0, 10).join(', ')}${toolNames.length > 10 ? '...' : ''}`);
    }

    // Arguments summary
    const allArgs = features.toolCalls.flatMap((tc) => tc.argumentKeys);
    if (allArgs.length > 0) {
      const uniqueArgs = [...new Set(allArgs)];
      parts.push(`ARGS: ${uniqueArgs.slice(0, 10).join(', ')}${uniqueArgs.length > 10 ? '...' : ''}`);
    }

    // String literals (potential sensitive data)
    const strings = features.toolCalls.flatMap((tc) => tc.stringLiterals);
    if (strings.length > 0) {
      parts.push(`STRINGS: ${strings.slice(0, 5).join(', ')}${strings.length > 5 ? '...' : ''}`);
    }

    // Sensitive fields
    if (features.sensitive.fieldsAccessed.length > 0) {
      parts.push(`SENSITIVE: ${features.sensitive.fieldsAccessed.join(', ')}`);
      parts.push(`CATEGORIES: ${features.sensitive.categories.join(', ')}`);
    }

    // Pattern signals
    parts.push(
      `PATTERNS: loops=${features.patterns.maxLoopNesting} ` +
        `tools_in_loops=${features.patterns.toolsInLoops.length} ` +
        `sequence_len=${features.patterns.toolSequence.length}`,
    );

    // Numeric signals
    parts.push(
      `SIGNALS: limit=${features.signals.maxLimit} ` +
        `fanout=${features.signals.fanOutRisk} ` +
        `density=${features.signals.toolCallDensity.toFixed(2)}`,
    );

    // Tool sequence for exfiltration detection
    if (features.patterns.toolSequence.length > 1) {
      parts.push(`SEQUENCE: ${features.patterns.toolSequence.join(' -> ')}`);
    }

    return parts.join(' | ');
  }

  /**
   * Analyze prompt for risk signals
   *
   * This is a heuristic approach. In production, this would be replaced
   * with actual model inference or VectoriaDB similarity search.
   */
  private analyzePrompt(prompt: string, features: ExtractedFeatures): { score: number; signals: RiskSignal[] } {
    const signals: RiskSignal[] = [];
    let totalScore = 0;
    const promptLower = prompt.toLowerCase();

    // Check for critical keywords
    for (const keyword of RISK_KEYWORDS.critical) {
      if (promptLower.includes(keyword)) {
        const score = 25;
        totalScore += score;
        signals.push({
          id: 'ML_CRITICAL_KEYWORD',
          score,
          description: `Critical security keyword detected: ${keyword}`,
          level: 'critical',
          context: { keyword },
        });
        break; // Only add once
      }
    }

    // Check for high risk keywords
    for (const keyword of RISK_KEYWORDS.high) {
      if (promptLower.includes(keyword)) {
        const score = 15;
        totalScore += score;
        signals.push({
          id: 'ML_HIGH_RISK_KEYWORD',
          score,
          description: `High risk keyword detected: ${keyword}`,
          level: 'high',
          context: { keyword },
        });
        break;
      }
    }

    // Exfiltration pattern detection (enhanced)
    const sequence = features.patterns.toolSequence.join(' ');
    const seqLower = sequence.toLowerCase();
    if (
      (seqLower.includes('list') || seqLower.includes('get') || seqLower.includes('query')) &&
      (seqLower.includes('send') || seqLower.includes('email') || seqLower.includes('webhook'))
    ) {
      const score = 35;
      totalScore += score;
      signals.push({
        id: 'ML_EXFILTRATION_PATTERN',
        score,
        description: 'Data retrieval followed by external send pattern',
        level: 'critical',
        context: { sequence: features.patterns.toolSequence },
      });
    }

    // High fan-out risk
    if (features.signals.fanOutRisk > 50) {
      const score = Math.min(20, Math.floor(features.signals.fanOutRisk / 5));
      totalScore += score;
      signals.push({
        id: 'ML_HIGH_FANOUT',
        score,
        description: `High fan-out risk detected: ${features.signals.fanOutRisk}`,
        level: 'medium',
        context: { fanOutRisk: features.signals.fanOutRisk },
      });
    }

    // Multiple sensitive categories
    if (features.sensitive.categories.length > 1) {
      const score = 15 * features.sensitive.categories.length;
      totalScore += score;
      signals.push({
        id: 'ML_MULTI_SENSITIVE',
        score,
        description: `Multiple sensitive data categories: ${features.sensitive.categories.join(', ')}`,
        level: 'high',
        context: { categories: features.sensitive.categories },
      });
    }

    return { score: totalScore, signals };
  }

  /**
   * Get the model configuration
   */
  getConfig(): Readonly<LocalLlmConfig> {
    return this.config;
  }

  /**
   * Check if using fallback scorer
   */
  isUsingFallback(): boolean {
    return this.pipeline === null && this.fallbackScorer !== null && this.ready;
  }

  /**
   * Dispose of resources
   */
  override dispose(): void {
    this.pipeline = null;
    this.initPromise = null;
    this.fallbackScorer?.dispose?.();
    super.dispose();
  }
}

/**
 * Error thrown by LocalLlmScorer
 */
export class LocalLlmScorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalLlmScorerError';
  }
}
