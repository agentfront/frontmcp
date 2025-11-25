import type * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { ValidationRule, ValidationContext } from '../interfaces';
import { ValidationSeverity } from '../interfaces';

/**
 * Configuration options for UnknownGlobalRule
 */
export interface UnknownGlobalOptions {
  /**
   * List of allowed global identifiers
   * Default: ['callTool', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Date']
   */
  allowedGlobals?: string[];

  /**
   * Whether to allow standard JavaScript globals (Infinity, NaN, isNaN, isFinite, etc.)
   * Default: true
   */
  allowStandardGlobals?: boolean;

  /**
   * Custom error message
   */
  message?: string;
}

/**
 * Standard JavaScript global identifiers that are always safe
 * These are built-in constants and functions that don't provide escape vectors
 */
const STANDARD_SAFE_GLOBALS = new Set([
  // Literals (handled by parser, but included for completeness)
  'undefined',
  'null',
  'true',
  'false',
  'Infinity',
  'NaN',

  // Safe utility functions
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
]);

/**
 * UnknownGlobalRule - Validates that all identifier references are either declared or allowed
 *
 * This rule implements a **whitelist-based approach** for identifiers:
 * - All identifiers must be either:
 *   1. Declared locally (variables, parameters, functions)
 *   2. Explicitly in the `allowedGlobals` list
 *   3. Standard safe globals (if enabled)
 *
 * **Purpose:**
 * - Prevent access to dangerous globals (process, require, window, etc.)
 * - Ensure explicit control over available APIs
 * - Create a secure sandbox with known capabilities
 *
 * **Example violations:**
 * ```javascript
 * console.log('hello');          // ❌ BLOCKED: console not in allowedGlobals
 * const x = process.env.HOME;    // ❌ BLOCKED: process not allowed
 * fetch('https://api.com');      // ❌ BLOCKED: fetch not allowed
 * ```
 *
 * **Valid code (with default allowedGlobals):**
 * ```javascript
 * const data = await callTool('users:list', {});  // ✅ callTool in allowedGlobals
 * const max = Math.max(1, 2, 3);                  // ✅ Math in allowedGlobals
 * const obj = JSON.parse('{"a":1}');              // ✅ JSON in allowedGlobals
 * const local = 42;                               // ✅ locally declared
 * ```
 *
 * @example
 * ```typescript
 * const rule = new UnknownGlobalRule({
 *   allowedGlobals: ['callTool', 'getTool', 'Math', 'JSON'],
 *   allowStandardGlobals: true,
 * });
 * ```
 */
export class UnknownGlobalRule implements ValidationRule {
  readonly name = 'unknown-global';
  readonly description =
    'Validates that all identifier references are either declared locally or in allowed globals list';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  private readonly allowedGlobals: Set<string>;
  private readonly customMessage?: string;

  constructor(options: UnknownGlobalOptions = {}) {
    const baseGlobals = options.allowedGlobals || [
      'callTool',
      'Math',
      'JSON',
      'Array',
      'Object',
      'String',
      'Number',
      'Date',
    ];
    this.allowedGlobals = new Set(baseGlobals);

    // Add standard safe globals if enabled
    if (options.allowStandardGlobals !== false) {
      STANDARD_SAFE_GLOBALS.forEach((g) => this.allowedGlobals.add(g));
    }

    this.customMessage = options.message;
  }

  validate(context: ValidationContext): void {
    const { ast } = context;

    // Build symbol table of all declared identifiers
    const declaredIdentifiers = new Set<string>();
    this.collectDeclarations(ast, declaredIdentifiers);

    // Check all identifier references
    walk.ancestor(ast, {
      Identifier: (node: any, ancestors: any[]) => {
        // Skip if this is a declaration (already in declaredIdentifiers)
        if (this.isDeclaration(node, ancestors)) {
          return;
        }

        // Skip if this is a property name (not a reference)
        if (this.isPropertyName(node, ancestors)) {
          return;
        }

        const identifierName = node.name;

        // Check if identifier is declared or allowed
        if (!declaredIdentifiers.has(identifierName) && !this.allowedGlobals.has(identifierName)) {
          context.report({
            code: 'UNKNOWN_GLOBAL',
            message:
              this.customMessage ||
              `Unknown identifier "${identifierName}". ` +
                `All identifiers must be either declared locally or in the allowed globals list. ` +
                `Allowed globals: ${Array.from(this.allowedGlobals).sort().join(', ')}`,
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                  endLine: node.loc.end.line,
                  endColumn: node.loc.end.column,
                }
              : undefined,
            data: {
              identifier: identifierName,
              allowedGlobals: Array.from(this.allowedGlobals).sort(),
            },
          });
        }
      },
    });
  }

  /**
   * Collect all declared identifiers in the AST
   *
   * **Note on scope handling:** This method builds a flat symbol table without
   * tracking lexical scope. All declarations are collected into a single set
   * regardless of where they're declared. This is an intentional simplification
   * for performance reasons, and works correctly when used with AgentScript v1
   * where user-defined functions are blocked by default (NoUserDefinedFunctionsRule).
   *
   * If user functions are enabled, inner-scope declarations will "whitelist"
   * that identifier name globally, which may cause false negatives. Example:
   * ```javascript
   * function inner() { const x = 1; }  // declares 'x'
   * Math.max(x, 5);  // 'x' passes because it's in the flat declared set
   * ```
   */
  private collectDeclarations(ast: acorn.Node, declared: Set<string>): void {
    walk.simple(ast, {
      // Variable declarations
      VariableDeclarator: (node: any) => {
        this.collectPatternIdentifiers(node.id, declared);
      },

      // Function declarations
      FunctionDeclaration: (node: any) => {
        if (node.id) {
          declared.add(node.id.name);
        }
        // Parameters are scoped to the function
        if (node.params) {
          node.params.forEach((param: any) => {
            this.collectPatternIdentifiers(param, declared);
          });
        }
      },

      // Function expressions
      FunctionExpression: (node: any) => {
        if (node.id) {
          declared.add(node.id.name);
        }
        if (node.params) {
          node.params.forEach((param: any) => {
            this.collectPatternIdentifiers(param, declared);
          });
        }
      },

      // Arrow functions
      ArrowFunctionExpression: (node: any) => {
        if (node.params) {
          node.params.forEach((param: any) => {
            this.collectPatternIdentifiers(param, declared);
          });
        }
      },

      // Class declarations
      ClassDeclaration: (node: any) => {
        if (node.id) {
          declared.add(node.id.name);
        }
      },

      // Import declarations
      ImportSpecifier: (node: any) => {
        if (node.local) {
          declared.add(node.local.name);
        }
      },

      ImportDefaultSpecifier: (node: any) => {
        if (node.local) {
          declared.add(node.local.name);
        }
      },

      ImportNamespaceSpecifier: (node: any) => {
        if (node.local) {
          declared.add(node.local.name);
        }
      },

      // Catch clause
      CatchClause: (node: any) => {
        if (node.param) {
          this.collectPatternIdentifiers(node.param, declared);
        }
      },

      // For-in / For-of loop variables
      ForInStatement: (node: any) => {
        if (node.left.type === 'VariableDeclaration') {
          node.left.declarations.forEach((decl: any) => {
            this.collectPatternIdentifiers(decl.id, declared);
          });
        }
      },

      ForOfStatement: (node: any) => {
        if (node.left.type === 'VariableDeclaration') {
          node.left.declarations.forEach((decl: any) => {
            this.collectPatternIdentifiers(decl.id, declared);
          });
        }
      },
    });
  }

  /**
   * Collect identifiers from patterns (destructuring, etc.)
   */
  private collectPatternIdentifiers(pattern: any, declared: Set<string>): void {
    if (pattern.type === 'Identifier') {
      declared.add(pattern.name);
    } else if (pattern.type === 'ObjectPattern') {
      pattern.properties.forEach((prop: any) => {
        if (prop.type === 'Property') {
          this.collectPatternIdentifiers(prop.value, declared);
        } else if (prop.type === 'RestElement') {
          this.collectPatternIdentifiers(prop.argument, declared);
        }
      });
    } else if (pattern.type === 'ArrayPattern') {
      pattern.elements.forEach((elem: any) => {
        if (elem) {
          this.collectPatternIdentifiers(elem, declared);
        }
      });
    } else if (pattern.type === 'AssignmentPattern') {
      this.collectPatternIdentifiers(pattern.left, declared);
    } else if (pattern.type === 'RestElement') {
      this.collectPatternIdentifiers(pattern.argument, declared);
    }
  }

  /**
   * Check if this identifier node is part of a declaration
   */
  private isDeclaration(node: any, ancestors: any[]): boolean {
    if (ancestors.length < 2) return false;
    const parent = ancestors[ancestors.length - 2];

    // Variable declarator
    if (parent.type === 'VariableDeclarator' && parent.id === node) {
      return true;
    }

    // Function/class declaration
    if ((parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration') && parent.id === node) {
      return true;
    }

    // Function expression name
    if (parent.type === 'FunctionExpression' && parent.id === node) {
      return true;
    }

    // Import specifier
    if (
      (parent.type === 'ImportSpecifier' ||
        parent.type === 'ImportDefaultSpecifier' ||
        parent.type === 'ImportNamespaceSpecifier') &&
      parent.local === node
    ) {
      return true;
    }

    // Catch clause parameter
    if (parent.type === 'CatchClause' && parent.param === node) {
      return true;
    }

    return false;
  }

  /**
   * Check if this identifier is a property name (not a value reference)
   */
  private isPropertyName(node: any, ancestors: any[]): boolean {
    if (ancestors.length < 2) return false;
    const parent = ancestors[ancestors.length - 2];

    // Object property key: { foo: value }
    if (parent.type === 'Property' && parent.key === node && !parent.computed) {
      return true;
    }

    // Method definition key: class { foo() {} }
    if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) {
      return true;
    }

    // Member expression property: obj.foo (but not obj[foo])
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
      return true;
    }

    return false;
  }
}
