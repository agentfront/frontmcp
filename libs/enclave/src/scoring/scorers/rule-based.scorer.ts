/**
 * Rule-Based Scorer
 *
 * Zero-dependency scorer that uses pure TypeScript rules to detect
 * attack patterns. Fast (~1ms) and suitable for production use.
 *
 * @packageDocumentation
 */

import { BaseScorer } from '../scorer.interface';
import { FeatureExtractor } from '../feature-extractor';
import type { ExtractedFeatures, ScoringResult, RiskSignal, RiskLevel, RuleId } from '../types';
import { RULE_THRESHOLDS } from '../types';

/**
 * Score values for each rule
 */
const RULE_SCORES: Record<RuleId, number> = {
  SENSITIVE_FIELD: 35, // Base score for sensitive field access
  EXCESSIVE_LIMIT: 25,
  WILDCARD_QUERY: 20,
  LOOP_TOOL_CALL: 25,
  EXFIL_PATTERN: 50,
  EXTREME_VALUE: 30,
  DYNAMIC_TOOL: 20,
  BULK_OPERATION: 15,
};

/**
 * Additional score modifiers for sensitive categories
 */
const SENSITIVE_CATEGORY_SCORES: Record<string, number> = {
  authentication: 20, // Extra points for auth-related fields
  pii: 15, // Extra for PII
  financial: 20, // Extra for financial
  internal: 10, // Extra for internal fields
};

/**
 * Known exfiltration patterns (fetch tool → send tool)
 */
const EXFILTRATION_SEQUENCES: [RegExp, RegExp][] = [
  [/list|get|query|search|find/i, /send|email|post|webhook/i],
  [/fetch|read|select/i, /export|upload|transfer/i],
  [/dump|backup/i, /send|post|upload/i],
];

/**
 * Rule-Based Scorer
 *
 * Implements detection rules for common attack patterns:
 * - SENSITIVE_FIELD: Accessing password, token, secret fields
 * - EXCESSIVE_LIMIT: Very high limit values (>10,000)
 * - WILDCARD_QUERY: Empty filters or wildcard queries
 * - LOOP_TOOL_CALL: Tool calls inside loops (fan-out)
 * - EXFIL_PATTERN: Data fetch followed by send pattern
 * - EXTREME_VALUE: Very large numeric values (>1,000,000)
 * - DYNAMIC_TOOL: Variable tool names
 * - BULK_OPERATION: Bulk/batch operation names
 */
export class RuleBasedScorer extends BaseScorer {
  readonly type = 'rule-based' as const;
  readonly name = 'RuleBasedScorer';

  private customRules: Record<string, number>;

  constructor(customRules?: Record<string, number>) {
    super();
    this.customRules = customRules ?? {};
    this.ready = true; // Rule-based scorer is always ready
  }

  async score(features: ExtractedFeatures): Promise<ScoringResult> {
    const startTime = performance.now();
    const signals: RiskSignal[] = [];

    // Rule 1: Sensitive field access
    this.checkSensitiveFields(features, signals);

    // Rule 2: Excessive limits
    this.checkExcessiveLimits(features, signals);

    // Rule 3: Wildcard queries
    this.checkWildcardQueries(features, signals);

    // Rule 4: Loop tool calls (fan-out)
    this.checkLoopToolCalls(features, signals);

    // Rule 5: Exfiltration patterns
    this.checkExfiltrationPatterns(features, signals);

    // Rule 6: Extreme values
    this.checkExtremeValues(features, signals);

    // Rule 7: Dynamic tool names
    this.checkDynamicToolNames(features, signals);

    // Rule 8: Bulk operations
    this.checkBulkOperations(features, signals);

    // Calculate total score (capped at 100)
    const totalScore = this.clampScore(signals.reduce((sum, s) => sum + s.score, 0));

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(totalScore);

    return {
      totalScore,
      riskLevel,
      signals,
      scoringTimeMs: performance.now() - startTime,
      scorerType: 'rule-based',
    };
  }

  /**
   * Rule 1: Check for sensitive field access
   */
  private checkSensitiveFields(features: ExtractedFeatures, signals: RiskSignal[]): void {
    if (features.sensitive.fieldsAccessed.length === 0) {
      return;
    }

    // Base score for sensitive field access
    let score = RULE_SCORES.SENSITIVE_FIELD;

    // Add category bonuses
    for (const category of features.sensitive.categories) {
      score += SENSITIVE_CATEGORY_SCORES[category] ?? 0;
    }

    // Multiple sensitive fields increase score
    if (features.sensitive.fieldsAccessed.length > 1) {
      score += (features.sensitive.fieldsAccessed.length - 1) * 5;
    }

    signals.push({
      id: 'SENSITIVE_FIELD',
      score: Math.min(score, 60), // Cap at 60 for this rule
      description: `Accesses sensitive fields: ${features.sensitive.fieldsAccessed.slice(0, 5).join(', ')}${
        features.sensitive.fieldsAccessed.length > 5 ? '...' : ''
      }`,
      level: this.getLevelForScore(score),
      context: {
        fields: features.sensitive.fieldsAccessed,
        categories: features.sensitive.categories,
      },
    });
  }

  /**
   * Rule 2: Check for excessive limit values
   */
  private checkExcessiveLimits(features: ExtractedFeatures, signals: RiskSignal[]): void {
    if (features.signals.maxLimit <= RULE_THRESHOLDS.EXCESSIVE_LIMIT) {
      return;
    }

    // Scale score based on how excessive the limit is
    let score = RULE_SCORES.EXCESSIVE_LIMIT;
    if (features.signals.maxLimit > 100000) {
      score += 10;
    }
    if (features.signals.maxLimit > 1000000) {
      score += 15;
    }

    signals.push({
      id: 'EXCESSIVE_LIMIT',
      score,
      description: `Excessive limit value: ${features.signals.maxLimit.toLocaleString()}`,
      level: this.getLevelForScore(score),
      context: { maxLimit: features.signals.maxLimit },
    });
  }

  /**
   * Rule 3: Check for wildcard queries
   */
  private checkWildcardQueries(features: ExtractedFeatures, signals: RiskSignal[]): void {
    // Check for "*" or empty string in arguments
    let foundWildcard = false;

    for (const tc of features.toolCalls) {
      // Check for wildcard strings
      if (tc.stringLiterals.some((s) => s === '*' || s === '**' || s === '%')) {
        foundWildcard = true;
        break;
      }

      // Check for empty filter object (no arguments but has query-like name)
      if (tc.argumentKeys.length === 0 && /query|search|find|filter/i.test(tc.toolName)) {
        foundWildcard = true;
        break;
      }
    }

    if (!foundWildcard) {
      return;
    }

    signals.push({
      id: 'WILDCARD_QUERY',
      score: RULE_SCORES.WILDCARD_QUERY,
      description: 'Uses wildcard or empty filter query',
      level: 'medium',
    });
  }

  /**
   * Rule 4: Check for tool calls inside loops
   */
  private checkLoopToolCalls(features: ExtractedFeatures, signals: RiskSignal[]): void {
    const toolsInLoops = features.patterns.toolsInLoops;

    if (toolsInLoops.length === 0) {
      return;
    }

    // Scale score based on number of tools in loops and nesting
    let score = RULE_SCORES.LOOP_TOOL_CALL * toolsInLoops.length;

    // Deep nesting increases score
    if (features.patterns.maxLoopNesting > 1) {
      score += 10 * (features.patterns.maxLoopNesting - 1);
    }

    // Iterating over tool results is especially risky
    if (features.patterns.iteratesOverToolResults) {
      score += 15;
    }

    signals.push({
      id: 'LOOP_TOOL_CALL',
      score: Math.min(score, 50), // Cap at 50
      description: `${toolsInLoops.length} tool(s) called inside loops with max nesting ${features.patterns.maxLoopNesting}`,
      level: this.getLevelForScore(score),
      context: {
        toolsInLoops,
        maxLoopNesting: features.patterns.maxLoopNesting,
        iteratesOverToolResults: features.patterns.iteratesOverToolResults,
      },
    });
  }

  /**
   * Rule 5: Check for exfiltration patterns
   */
  private checkExfiltrationPatterns(features: ExtractedFeatures, signals: RiskSignal[]): void {
    const sequence = features.patterns.toolSequence;

    if (sequence.length < 2) {
      return;
    }

    // Check for fetch→send patterns
    for (let i = 0; i < sequence.length - 1; i++) {
      const current = sequence[i];
      const next = sequence[i + 1];

      for (const [fetchPattern, sendPattern] of EXFILTRATION_SEQUENCES) {
        if (fetchPattern.test(current) && sendPattern.test(next)) {
          signals.push({
            id: 'EXFIL_PATTERN',
            score: RULE_SCORES.EXFIL_PATTERN,
            description: `Potential data exfiltration: ${current} → ${next}`,
            level: 'critical',
            context: { fetchTool: current, sendTool: next },
          });
          return; // Only report once
        }
      }
    }

    // Also check using the static helper
    if (FeatureExtractor.detectExfiltrationPattern(sequence)) {
      signals.push({
        id: 'EXFIL_PATTERN',
        score: RULE_SCORES.EXFIL_PATTERN,
        description: 'Potential data exfiltration pattern detected',
        level: 'critical',
        context: { toolSequence: sequence },
      });
    }
  }

  /**
   * Rule 6: Check for extreme numeric values
   */
  private checkExtremeValues(features: ExtractedFeatures, signals: RiskSignal[]): void {
    // Check all tool calls for extreme values
    for (const tc of features.toolCalls) {
      const extremeValues = tc.numericLiterals.filter((n) => n > RULE_THRESHOLDS.EXTREME_VALUE);

      if (extremeValues.length > 0) {
        signals.push({
          id: 'EXTREME_VALUE',
          score: RULE_SCORES.EXTREME_VALUE,
          description: `Extreme numeric value in ${tc.toolName}: ${extremeValues[0].toLocaleString()}`,
          level: 'high',
          context: { toolName: tc.toolName, values: extremeValues },
        });
        return; // Only report once
      }
    }
  }

  /**
   * Rule 7: Check for dynamic tool names
   */
  private checkDynamicToolNames(features: ExtractedFeatures, signals: RiskSignal[]): void {
    const dynamicCalls = features.toolCalls.filter((tc) => !tc.isStaticName);

    if (dynamicCalls.length === 0) {
      return;
    }

    const score = RULE_SCORES.DYNAMIC_TOOL * dynamicCalls.length;

    signals.push({
      id: 'DYNAMIC_TOOL',
      score: Math.min(score, 40), // Cap at 40
      description: `${dynamicCalls.length} tool call(s) with dynamic/variable names`,
      level: 'medium',
      context: {
        count: dynamicCalls.length,
        locations: dynamicCalls.map((tc) => tc.location),
      },
    });
  }

  /**
   * Rule 8: Check for bulk operations
   */
  private checkBulkOperations(features: ExtractedFeatures, signals: RiskSignal[]): void {
    const bulkTools = features.toolCalls.filter((tc) => FeatureExtractor.isBulkOperation(tc.toolName));

    if (bulkTools.length === 0) {
      return;
    }

    const score = RULE_SCORES.BULK_OPERATION * bulkTools.length;
    const toolNames = bulkTools.map((tc) => tc.toolName);

    signals.push({
      id: 'BULK_OPERATION',
      score: Math.min(score, 30), // Cap at 30
      description: `Bulk operation(s) detected: ${toolNames.join(', ')}`,
      level: 'medium',
      context: { tools: toolNames },
    });
  }

  /**
   * Get risk level for a specific score
   */
  private getLevelForScore(score: number): RiskLevel {
    if (score >= 50) return 'critical';
    if (score >= 35) return 'high';
    if (score >= 20) return 'medium';
    if (score >= 10) return 'low';
    return 'none';
  }
}
