/**
 * Feature Extractor
 *
 * Analyzes AST to extract security-relevant features for scoring.
 * This is the shared foundation used by all scorer implementations.
 *
 * @packageDocumentation
 */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { createHash } from 'crypto';
import type {
  ExtractedFeatures,
  ExtractedToolCall,
  PatternSignals,
  NumericSignals,
  SensitiveAccess,
  SensitiveCategory,
  ExtractionMeta,
} from './types';
import { RULE_THRESHOLDS } from './types';

/**
 * Regex patterns for sensitive field detection
 */
const SENSITIVE_PATTERNS: Record<SensitiveCategory, RegExp> = {
  authentication: /password|token|secret|api.?key|auth|credential|bearer/i,
  pii: /email|ssn|phone|address|credit.?card|birth.?date|social.?security/i,
  financial: /bank|routing|account.?num|iban|swift|cvv|pin/i,
  internal: /^__|^_[a-z]/,
};

/**
 * Patterns that suggest bulk/batch operations
 */
const BULK_PATTERNS = /bulk|batch|all|mass|multi/i;

/**
 * Patterns that suggest data sending/exfiltration
 */
const SEND_PATTERNS = /send|email|notify|post|webhook|export|upload|transfer/i;

/**
 * Patterns that suggest data retrieval
 */
const FETCH_PATTERNS = /list|get|query|search|find|fetch|read|select/i;

/**
 * Fields commonly used for limiting results
 */
const LIMIT_FIELD_NAMES = ['limit', 'pagesize', 'count', 'max', 'top', 'size', 'take'];

/**
 * Feature Extractor - extracts security-relevant features from code
 */
export class FeatureExtractor {
  /**
   * Extract features from code
   *
   * @param code - Source code to analyze
   * @returns Extracted features for scoring
   */
  extract(code: string): ExtractedFeatures {
    const startTime = performance.now();

    // Parse code into AST
    const ast = this.parseCode(code);

    // Extract tool calls and patterns
    const toolCalls: ExtractedToolCall[] = [];
    const toolSequence: string[] = [];
    const sensitiveFields = new Set<string>();
    const sensitiveCategories = new Set<SensitiveCategory>();

    // Track loop depth during traversal
    let maxLoopNesting = 0;
    let iteratesOverToolResults = false;

    // Collect all numeric literals for limit detection
    const allNumericLiterals: number[] = [];
    const allStringLiterals: string[] = [];

    // Track variables assigned from tool calls
    const toolResultVars = new Set<string>();

    // Helper function to count loop ancestors
    const countLoopAncestors = (ancestors: acorn.Node[]): number => {
      let count = 0;
      for (const ancestor of ancestors) {
        const type = (ancestor as unknown as { type: string }).type;
        if (
          type === 'ForStatement' ||
          type === 'ForOfStatement' ||
          type === 'ForInStatement' ||
          type === 'WhileStatement' ||
          type === 'DoWhileStatement'
        ) {
          count++;
        }
      }
      return count;
    };

    // Walk with ancestors to properly track loop depth
    walk.ancestor(ast, {
      CallExpression: (node: acorn.Node, _state: unknown, ancestors: acorn.Node[]) => {
        const loopDepth = countLoopAncestors(ancestors);
        maxLoopNesting = Math.max(maxLoopNesting, loopDepth);
        this.extractToolCall(
          node,
          loopDepth,
          toolCalls,
          toolSequence,
          allNumericLiterals,
          allStringLiterals,
          sensitiveFields,
          sensitiveCategories,
        );
      },

      ForOfStatement: (node: acorn.Node) => {
        const forOfNode = node as unknown as { right?: { type?: string; name?: string } };
        // Check if iterating over a tool result variable
        if (forOfNode.right?.type === 'Identifier' && toolResultVars.has(forOfNode.right.name ?? '')) {
          iteratesOverToolResults = true;
        }
      },

      // Track variable assignments from tool calls
      VariableDeclarator: (node: acorn.Node) => {
        const varNode = node as unknown as {
          id?: { type?: string; name?: string };
          init?: { type?: string; callee?: { name?: string } };
        };
        if (varNode.id?.type === 'Identifier' && varNode.init?.type === 'AwaitExpression') {
          // Check if it's a callTool result
          const awaitArg = (varNode.init as unknown as { argument?: { type?: string; callee?: { name?: string } } })
            .argument;
          if (awaitArg?.type === 'CallExpression') {
            const calleeName = awaitArg.callee?.name;
            if (calleeName === 'callTool' || calleeName === '__safe_callTool') {
              if (varNode.id.name) {
                toolResultVars.add(varNode.id.name);
              }
            }
          }
        }
      },

      // Extract literals
      Literal: (node: acorn.Node) => {
        const literalNode = node as unknown as { value?: unknown };
        if (typeof literalNode.value === 'number') {
          allNumericLiterals.push(literalNode.value);
        } else if (typeof literalNode.value === 'string') {
          allStringLiterals.push(literalNode.value);
          this.detectSensitiveField(literalNode.value, sensitiveFields, sensitiveCategories);
        }
      },

      // Check property access for sensitive fields
      MemberExpression: (node: acorn.Node) => {
        const memberNode = node as unknown as {
          property?: { type?: string; name?: string; value?: string };
        };
        const propName =
          memberNode.property?.type === 'Identifier'
            ? memberNode.property.name
            : memberNode.property?.type === 'Literal'
            ? String(memberNode.property.value)
            : undefined;

        if (propName) {
          this.detectSensitiveField(propName, sensitiveFields, sensitiveCategories);
        }
      },
    });

    // Build features
    const lineCount = code.split('\n').length;
    const uniqueTools = new Set(toolCalls.filter((tc) => tc.isStaticName).map((tc) => tc.toolName));
    const toolsInLoops = [...new Set(toolCalls.filter((tc) => tc.insideLoop).map((tc) => tc.toolName))];

    // Calculate fan-out risk
    const fanOutRisk = this.calculateFanOutRisk(toolCalls, toolsInLoops.length, maxLoopNesting);

    // Find max limit value
    const maxLimit = this.findMaxLimitValue(toolCalls, allNumericLiterals);

    const patterns: PatternSignals = {
      totalToolCalls: toolCalls.length,
      uniqueToolsCount: uniqueTools.size,
      toolsInLoops,
      maxLoopNesting,
      toolSequence,
      iteratesOverToolResults,
    };

    const signals: NumericSignals = {
      maxLimit,
      maxStringLength: allStringLiterals.reduce((max, s) => Math.max(max, s.length), 0),
      toolCallDensity: lineCount > 0 ? toolCalls.length / lineCount : 0,
      fanOutRisk,
    };

    const sensitive: SensitiveAccess = {
      fieldsAccessed: [...sensitiveFields],
      categories: [...sensitiveCategories],
    };

    const meta: ExtractionMeta = {
      extractionTimeMs: performance.now() - startTime,
      codeHash: this.hashCode(code),
      lineCount,
    };

    return {
      toolCalls,
      patterns,
      signals,
      sensitive,
      meta,
    };
  }

  /**
   * Parse code into AST
   */
  private parseCode(code: string): acorn.Node {
    try {
      return acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
    } catch {
      // If parsing fails, return an empty program
      return acorn.parse('', { ecmaVersion: 'latest' });
    }
  }

  /**
   * Extract tool call information
   */
  private extractToolCall(
    node: acorn.Node,
    loopDepth: number,
    toolCalls: ExtractedToolCall[],
    toolSequence: string[],
    allNumericLiterals: number[],
    allStringLiterals: string[],
    sensitiveFields: Set<string>,
    sensitiveCategories: Set<SensitiveCategory>,
  ): void {
    const callNode = node as unknown as {
      callee?: { type?: string; name?: string };
      arguments?: unknown[];
      loc?: { start?: { line: number; column: number } };
    };

    const calleeName = callNode.callee?.type === 'Identifier' ? callNode.callee.name : undefined;

    // Check if this is a callTool or __safe_callTool call
    if (calleeName !== 'callTool' && calleeName !== '__safe_callTool') {
      return;
    }

    const args = callNode.arguments ?? [];
    const [toolNameArg, toolArgsArg] = args;

    // Extract tool name
    const toolNameNode = toolNameArg as unknown as { type?: string; value?: string };
    const isStaticName = toolNameNode?.type === 'Literal' && typeof toolNameNode.value === 'string';
    const toolName = isStaticName ? toolNameNode.value! : '<dynamic>';

    // Extract argument information
    const argumentKeys: string[] = [];
    const stringLiterals: string[] = [];
    const numericLiterals: number[] = [];

    if (toolArgsArg) {
      this.extractFromArgs(
        toolArgsArg,
        argumentKeys,
        stringLiterals,
        numericLiterals,
        sensitiveFields,
        sensitiveCategories,
      );
    }

    const toolCall: ExtractedToolCall = {
      toolName,
      isStaticName,
      argumentKeys,
      stringLiterals,
      numericLiterals,
      insideLoop: loopDepth > 0,
      loopDepth,
      location: {
        line: callNode.loc?.start?.line ?? 0,
        column: callNode.loc?.start?.column ?? 0,
      },
    };

    toolCalls.push(toolCall);

    // Add to sequence if static
    if (isStaticName) {
      toolSequence.push(toolName);
    }

    // Add to overall literals
    allNumericLiterals.push(...numericLiterals);
    allStringLiterals.push(...stringLiterals);
  }

  /**
   * Extract information from tool arguments
   */
  private extractFromArgs(
    argsNode: unknown,
    argumentKeys: string[],
    stringLiterals: string[],
    numericLiterals: number[],
    sensitiveFields: Set<string>,
    sensitiveCategories: Set<SensitiveCategory>,
  ): void {
    const objNode = argsNode as unknown as {
      type?: string;
      properties?: Array<{
        key?: { type?: string; name?: string; value?: string };
        value?: { type?: string; value?: unknown };
      }>;
    };

    if (objNode.type !== 'ObjectExpression') {
      return;
    }

    for (const prop of objNode.properties ?? []) {
      // Get property key
      const keyName =
        prop.key?.type === 'Identifier'
          ? prop.key.name
          : prop.key?.type === 'Literal'
          ? String(prop.key.value)
          : undefined;

      if (keyName) {
        argumentKeys.push(keyName);
        this.detectSensitiveField(keyName, sensitiveFields, sensitiveCategories);
      }

      // Get property value
      if (prop.value?.type === 'Literal') {
        const value = prop.value.value;
        if (typeof value === 'string') {
          stringLiterals.push(value);
          this.detectSensitiveField(value, sensitiveFields, sensitiveCategories);
        } else if (typeof value === 'number') {
          numericLiterals.push(value);
        }
      }
    }
  }

  /**
   * Detect if a field name is sensitive
   */
  private detectSensitiveField(
    fieldName: string,
    sensitiveFields: Set<string>,
    sensitiveCategories: Set<SensitiveCategory>,
  ): void {
    for (const [category, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      if (pattern.test(fieldName)) {
        sensitiveFields.add(fieldName);
        sensitiveCategories.add(category as SensitiveCategory);
      }
    }
  }

  /**
   * Calculate fan-out risk score
   */
  private calculateFanOutRisk(
    toolCalls: ExtractedToolCall[],
    toolsInLoopsCount: number,
    maxLoopNesting: number,
  ): number {
    let risk = 0;

    // Tools in loops increase risk
    risk += toolsInLoopsCount * 15;

    // Deep loop nesting increases risk
    risk += maxLoopNesting * 10;

    // Many tool calls increase risk
    if (toolCalls.length > RULE_THRESHOLDS.HIGH_DENSITY_CALLS) {
      risk += (toolCalls.length - RULE_THRESHOLDS.HIGH_DENSITY_CALLS) * 3;
    }

    // Check for bulk operation patterns
    for (const tc of toolCalls) {
      if (BULK_PATTERNS.test(tc.toolName)) {
        risk += 15;
      }
    }

    return Math.min(100, risk);
  }

  /**
   * Find maximum limit value from tool calls and literals
   */
  private findMaxLimitValue(toolCalls: ExtractedToolCall[], allNumericLiterals: number[]): number {
    let maxLimit = 0;

    // Check tool call arguments for limit fields
    for (const tc of toolCalls) {
      const hasLimitArg = tc.argumentKeys.some((key) => LIMIT_FIELD_NAMES.includes(key.toLowerCase()));

      if (hasLimitArg) {
        // Use the largest numeric literal in this tool call as the limit
        for (const num of tc.numericLiterals) {
          if (num > maxLimit) {
            maxLimit = num;
          }
        }
      }
    }

    // Also check all numeric literals > 1000 as potential limits
    for (const num of allNumericLiterals) {
      if (num > 1000 && num > maxLimit) {
        maxLimit = num;
      }
    }

    return maxLimit;
  }

  /**
   * Hash code for caching
   */
  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex').substring(0, 16);
  }

  /**
   * Check if a tool sequence indicates potential exfiltration
   */
  static detectExfiltrationPattern(toolSequence: string[]): boolean {
    // Look for fetch followed by send patterns
    let lastWasFetch = false;

    for (const toolName of toolSequence) {
      if (FETCH_PATTERNS.test(toolName)) {
        lastWasFetch = true;
      } else if (lastWasFetch && SEND_PATTERNS.test(toolName)) {
        return true;
      } else {
        lastWasFetch = false;
      }
    }

    return false;
  }

  /**
   * Check if a tool name suggests bulk operations
   */
  static isBulkOperation(toolName: string): boolean {
    return BULK_PATTERNS.test(toolName);
  }

  /**
   * Check if a tool name suggests data sending
   */
  static isSendOperation(toolName: string): boolean {
    return SEND_PATTERNS.test(toolName);
  }
}
