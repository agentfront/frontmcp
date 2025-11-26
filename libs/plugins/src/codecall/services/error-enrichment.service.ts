// file: libs/plugins/src/codecall/services/error-enrichment.service.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';

/**
 * Error categories for classification.
 */
export const ERROR_CATEGORIES = {
  /** Script syntax or parsing error */
  SYNTAX: 'syntax',
  /** AST validation blocked dangerous code */
  SECURITY: 'security',
  /** Script exceeded timeout */
  TIMEOUT: 'timeout',
  /** Tool not found */
  TOOL_NOT_FOUND: 'tool_not_found',
  /** Tool access denied */
  TOOL_ACCESS_DENIED: 'tool_access_denied',
  /** Tool validation error */
  TOOL_VALIDATION: 'tool_validation',
  /** Tool execution error */
  TOOL_EXECUTION: 'tool_execution',
  /** Runtime error in script */
  RUNTIME: 'runtime',
  /** Unknown error */
  UNKNOWN: 'unknown',
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];

/**
 * Enriched error with actionable suggestions.
 */
export interface EnrichedError {
  /** Error category */
  category: ErrorCategory;
  /** User-friendly error message */
  message: string;
  /** Actionable suggestions for fixing the error */
  suggestions: string[];
  /** Related documentation links */
  docs?: string[];
  /** Example of correct usage (if applicable) */
  example?: string;
  /** Original error code (if available) */
  code?: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Error patterns for classification.
 */
interface ErrorPattern {
  /** Pattern to match against error message */
  pattern: RegExp;
  /** Category to assign */
  category: ErrorCategory;
  /** Suggestions for this error type */
  suggestions: string[];
  /** Documentation links */
  docs?: string[];
  /** Example of correct usage */
  example?: string;
  /** Whether this error is recoverable */
  recoverable: boolean;
}

/**
 * Error patterns for classification and enrichment.
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // Syntax errors
  {
    pattern: /SyntaxError|Unexpected token|Unexpected identifier|missing \)|missing \}/i,
    category: ERROR_CATEGORIES.SYNTAX,
    suggestions: [
      'Check for missing parentheses, brackets, or braces',
      'Verify all strings are properly quoted',
      'Ensure semicolons are used correctly (if required)',
      'Check for typos in keywords like "function", "return", "const"',
    ],
    recoverable: true,
  },
  {
    pattern: /Unterminated string|Invalid or unexpected token/i,
    category: ERROR_CATEGORIES.SYNTAX,
    suggestions: [
      'Check that all strings are closed with matching quotes',
      'Ensure template literals use backticks (`)',
      'Verify there are no unescaped special characters in strings',
    ],
    recoverable: true,
  },

  // Security errors (AST validation)
  {
    pattern: /eval|Function constructor|dangerous pattern|blocked|forbidden/i,
    category: ERROR_CATEGORIES.SECURITY,
    suggestions: [
      'Avoid using eval() or new Function()',
      'Do not access global objects like process, require, or import',
      'Use callTool() to interact with external systems',
    ],
    docs: ['codecall/security'],
    recoverable: true,
  },
  {
    pattern: /self.?reference|codecall:/i,
    category: ERROR_CATEGORIES.SECURITY,
    suggestions: [
      'CodeCall tools (codecall:*) cannot be called from within scripts',
      'Use the tools directly from your LLM context instead',
    ],
    recoverable: false,
  },

  // Timeout errors
  {
    pattern: /timeout|timed out|exceeded.*time/i,
    category: ERROR_CATEGORIES.TIMEOUT,
    suggestions: [
      'Reduce the number of tool calls in your script',
      'Avoid infinite loops or deep recursion',
      'Break large operations into smaller scripts',
      'Consider using pagination for data fetching',
    ],
    recoverable: true,
  },

  // Tool not found
  {
    pattern: /tool.*not found|unknown tool|no such tool/i,
    category: ERROR_CATEGORIES.TOOL_NOT_FOUND,
    suggestions: [
      'Use codecall:search to find available tools',
      'Check the tool name for typos',
      'Verify the tool is available in your current context',
    ],
    example: `// First search for the tool
const results = await codecall:search({ query: "user management" });

// Then use the correct tool name
const user = await callTool('users:getById', { id: '123' });`,
    recoverable: true,
  },

  // Tool access denied
  {
    pattern: /access denied|permission denied|not authorized|forbidden/i,
    category: ERROR_CATEGORIES.TOOL_ACCESS_DENIED,
    suggestions: [
      'Check if the tool is in the allowedTools list',
      'Verify your authentication credentials',
      'Contact your administrator for access',
    ],
    recoverable: false,
  },

  // Tool validation errors
  {
    pattern: /validation|invalid input|required.*missing|type.*expected/i,
    category: ERROR_CATEGORIES.TOOL_VALIDATION,
    suggestions: [
      'Use codecall:describe to check the tool input schema',
      'Ensure all required parameters are provided',
      'Verify parameter types match the schema',
    ],
    example: `// Check tool schema first
const schema = await codecall:describe({ toolNames: ['users:create'] });

// Then provide correct input
const user = await callTool('users:create', {
  name: 'John',      // required: string
  email: 'j@ex.com', // required: string
  age: 30            // optional: number
});`,
    recoverable: true,
  },

  // Runtime errors
  {
    pattern: /TypeError|ReferenceError|is not defined|is not a function|cannot read property/i,
    category: ERROR_CATEGORIES.RUNTIME,
    suggestions: [
      'Check that all variables are defined before use',
      'Verify function names and property access',
      'Handle null/undefined values with optional chaining (?.) or nullish coalescing (??)',
    ],
    example: `// Use optional chaining for safe property access
const name = result?.user?.name ?? 'Unknown';

// Check for undefined before using
if (result && result.data) {
  return result.data;
}`,
    recoverable: true,
  },
  {
    pattern: /Maximum call stack|stack overflow|too much recursion/i,
    category: ERROR_CATEGORIES.RUNTIME,
    suggestions: [
      'Check for infinite recursion in your script',
      'Add a base case to recursive functions',
      'Consider using iteration instead of recursion',
    ],
    recoverable: true,
  },
];

/**
 * Error Enrichment Service
 *
 * Transforms raw errors into user-friendly, actionable error messages.
 * Provides suggestions for fixing common errors and links to documentation.
 *
 * Security: Never exposes internal details, only provides helpful guidance.
 */
@Provider({
  name: 'codecall:error-enrichment',
  scope: ProviderScope.GLOBAL,
})
export class ErrorEnrichmentService {
  /**
   * Enrich an error with category, suggestions, and examples.
   *
   * @param error - The error to enrich (Error object, string, or unknown)
   * @param context - Optional context for more specific suggestions
   * @returns Enriched error with actionable information
   */
  enrich(error: unknown, context?: { toolName?: string; scriptSnippet?: string }): EnrichedError {
    const message = this.extractMessage(error);
    const code = this.extractCode(error);

    // Try to match against known patterns
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.pattern.test(message)) {
        return {
          category: pattern.category,
          message: this.formatMessage(message, pattern.category),
          suggestions: this.contextualizeSuggestions(pattern.suggestions, context),
          docs: pattern.docs,
          example: pattern.example,
          code,
          recoverable: pattern.recoverable,
        };
      }
    }

    // Default to unknown error
    return {
      category: ERROR_CATEGORIES.UNKNOWN,
      message: this.formatMessage(message, ERROR_CATEGORIES.UNKNOWN),
      suggestions: [
        'Check your script for errors',
        'Use codecall:search to find available tools',
        'Use codecall:describe to check tool schemas',
      ],
      code,
      recoverable: true,
    };
  }

  /**
   * Enrich a tool-specific error.
   */
  enrichToolError(toolName: string, errorCode: string, rawMessage?: string): EnrichedError {
    switch (errorCode) {
      case 'NOT_FOUND':
        return {
          category: ERROR_CATEGORIES.TOOL_NOT_FOUND,
          message: `Tool "${toolName}" was not found`,
          suggestions: [
            `Use codecall:search to find tools similar to "${toolName}"`,
            'Check the tool name for typos',
            'The tool may not be available in your current context',
          ],
          recoverable: true,
        };

      case 'ACCESS_DENIED':
        return {
          category: ERROR_CATEGORIES.TOOL_ACCESS_DENIED,
          message: `Access denied for tool "${toolName}"`,
          suggestions: [
            'Check if the tool is in your allowedTools list',
            'Verify your authentication credentials',
            'Contact your administrator if you need access',
          ],
          recoverable: false,
        };

      case 'VALIDATION':
        return {
          category: ERROR_CATEGORIES.TOOL_VALIDATION,
          message: `Input validation failed for tool "${toolName}"`,
          suggestions: [
            `Run codecall:describe({ toolNames: ['${toolName}'] }) to see the expected schema`,
            'Ensure all required parameters are provided',
            'Check that parameter types are correct',
          ],
          example: `// Get tool schema
const info = await callTool('codecall:describe', { toolNames: ['${toolName}'] });
console.log(info.tools[0].inputSchema);`,
          recoverable: true,
        };

      case 'TIMEOUT':
        return {
          category: ERROR_CATEGORIES.TIMEOUT,
          message: `Tool "${toolName}" execution timed out`,
          suggestions: [
            'The operation may be taking too long',
            'Try with simpler or smaller inputs',
            'Consider breaking the operation into smaller parts',
          ],
          recoverable: true,
        };

      case 'SELF_REFERENCE':
        return {
          category: ERROR_CATEGORIES.SECURITY,
          message: `Cannot call CodeCall tool "${toolName}" from within a script`,
          suggestions: [
            'CodeCall meta-tools (codecall:*) cannot be called from scripts',
            'Use these tools directly from your LLM conversation',
            'For tool calls, use regular tools instead',
          ],
          recoverable: false,
        };

      default:
        return {
          category: ERROR_CATEGORIES.TOOL_EXECUTION,
          message: `Tool "${toolName}" execution failed`,
          suggestions: [
            'Check the tool input parameters',
            'Try with simpler inputs to isolate the issue',
            'The tool may be temporarily unavailable',
          ],
          recoverable: true,
        };
    }
  }

  /**
   * Create a brief error summary for logging.
   */
  summarize(error: unknown): string {
    const enriched = this.enrich(error);
    return `[${enriched.category}] ${enriched.message}`;
  }

  /**
   * Extract error message from various error types.
   */
  private extractMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return 'An unknown error occurred';
  }

  /**
   * Extract error code if available.
   */
  private extractCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return undefined;
  }

  /**
   * Format error message for user consumption.
   * Removes technical details while keeping useful information.
   */
  private formatMessage(message: string, category: ErrorCategory): string {
    // Remove file paths
    let formatted = message.replace(/(?:\/[\w.-]+)+|(?:[A-Za-z]:\\[\w\\.-]+)+/g, '');

    // Remove line numbers
    formatted = formatted.replace(/:\d+:\d+/g, '');

    // Remove stack traces
    formatted = formatted.replace(/\n\s*at .*/g, '');

    // Clean up whitespace
    formatted = formatted.replace(/\s+/g, ' ').trim();

    // Truncate if too long
    if (formatted.length > 200) {
      formatted = formatted.substring(0, 200) + '...';
    }

    // Add category prefix if message is too generic
    if (formatted.length < 20) {
      const prefix = this.getCategoryPrefix(category);
      if (prefix) {
        formatted = `${prefix}: ${formatted}`;
      }
    }

    return formatted || 'An error occurred';
  }

  /**
   * Get a human-readable prefix for error category.
   */
  private getCategoryPrefix(category: ErrorCategory): string {
    switch (category) {
      case ERROR_CATEGORIES.SYNTAX:
        return 'Syntax error';
      case ERROR_CATEGORIES.SECURITY:
        return 'Security violation';
      case ERROR_CATEGORIES.TIMEOUT:
        return 'Timeout';
      case ERROR_CATEGORIES.TOOL_NOT_FOUND:
        return 'Tool not found';
      case ERROR_CATEGORIES.TOOL_ACCESS_DENIED:
        return 'Access denied';
      case ERROR_CATEGORIES.TOOL_VALIDATION:
        return 'Validation error';
      case ERROR_CATEGORIES.TOOL_EXECUTION:
        return 'Execution error';
      case ERROR_CATEGORIES.RUNTIME:
        return 'Runtime error';
      default:
        return 'Error';
    }
  }

  /**
   * Contextualize suggestions based on context.
   */
  private contextualizeSuggestions(suggestions: string[], context?: { toolName?: string }): string[] {
    if (!context?.toolName) {
      return suggestions;
    }

    return suggestions.map((s) => s.replace(/the tool/gi, `"${context.toolName}"`));
  }
}

export default ErrorEnrichmentService;
