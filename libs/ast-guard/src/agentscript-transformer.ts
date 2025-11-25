/**
 * AgentScript Transformer
 *
 * Transforms user-written AgentScript code into safe, executable format:
 * 1. Wraps code in `async function __ag_main() { ... }`
 * 2. Transforms `callTool` → `__safe_callTool`
 * 3. Transforms loops → `__safe_for` / `__safe_forOf` / `__safe_while`
 *
 * @packageDocumentation
 */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import { transformAst } from './transformer';
import type { TransformConfig } from './interfaces';

/**
 * Configuration for AgentScript transformation
 */
export interface AgentScriptTransformConfig {
  /**
   * Whether to wrap code in async function __ag_main()
   * Default: true
   */
  wrapInMain?: boolean;

  /**
   * Whether to transform callTool → __safe_callTool
   * Default: true
   */
  transformCallTool?: boolean;

  /**
   * Whether to transform loops for runtime safety
   * Default: true
   */
  transformLoops?: boolean;

  /**
   * Prefix for safe runtime functions
   * Default: '__safe_'
   */
  prefix?: string;

  /**
   * Additional identifiers to transform
   * Default: []
   */
  additionalIdentifiers?: string[];

  /**
   * Parse options for acorn
   */
  parseOptions?: acorn.Options;
}

/**
 * Transform AgentScript code for safe execution
 *
 * **Transformation Steps:**
 * 1. Parse the code to AST
 * 2. Wrap in `async function __ag_main() { ... }` (if enabled)
 * 3. Transform `callTool` → `__safe_callTool` (if enabled)
 * 4. Transform loops → `__safe_for` / `__safe_forOf` (if enabled)
 * 5. Generate transformed code
 *
 * **Example:**
 * ```javascript
 * // Input:
 * const users = await callTool('users:list', {});
 * for (const user of users.items) {
 *   console.log(user.name);
 * }
 *
 * // Output:
 * async function __ag_main() {
 *   const users = await __safe_callTool('users:list', {});
 *   for (const user of __safe_forOf(users.items)) {
 *     console.log(user.name);
 *   }
 * }
 * ```
 *
 * @param code AgentScript code to transform
 * @param config Transformation configuration
 * @returns Transformed code ready for safe execution
 */
export function transformAgentScript(code: string, config: AgentScriptTransformConfig = {}): string {
  const {
    wrapInMain = true,
    transformCallTool = true,
    transformLoops = true,
    prefix = '__safe_',
    additionalIdentifiers = [],
    parseOptions = {},
  } = config;

  // Parse the code
  // AgentScript allows top-level return/await, so we wrap it in an async function for parsing
  const defaultParseOptions: acorn.Options = {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    ...parseOptions,
  };

  let ast: acorn.Node;
  let needsUnwrapping = false;

  try {
    // Try parsing as-is first
    ast = acorn.parse(code, defaultParseOptions) as unknown as acorn.Node;
  } catch (scriptErr) {
    // If parsing fails, try as module (for top-level await)
    try {
      ast = acorn.parse(code, { ...defaultParseOptions, sourceType: 'module' }) as unknown as acorn.Node;
    } catch (moduleErr) {
      // If still fails, wrap in async function to allow top-level return/await
      try {
        const wrappedCode = `async function __temp__() {\n${code}\n}`;
        ast = acorn.parse(wrappedCode, defaultParseOptions) as unknown as acorn.Node;
        needsUnwrapping = true;
      } catch (wrappedErr: unknown) {
        const error = wrappedErr as Error;
        throw new Error(`Failed to parse AgentScript code: ${error.message}`);
      }
    }
  }

  // If we wrapped the code, extract the function body
  if (needsUnwrapping) {
    // AST structure: Program -> FunctionDeclaration (__temp__) -> BlockStatement -> body
    const program = ast as any;
    if (program.body && program.body[0] && program.body[0].type === 'FunctionDeclaration') {
      const funcDecl = program.body[0];
      if (funcDecl.body && funcDecl.body.type === 'BlockStatement') {
        // Replace the program body with the function's body statements
        program.body = funcDecl.body.body;
      }
    }
  }

  // Step 1: Transform identifiers using WHITELIST mode
  // In AgentScript, we whitelist safe globals and transform everything else
  if (transformCallTool) {
    // Whitelist of allowed globals that should NOT be transformed
    const whitelistedIdentifiers = [
      // Standard safe globals (these are validated separately)
      'Math',
      'JSON',
      'Array',
      'Object',
      'String',
      'Number',
      'Date',
      'NaN',
      'Infinity',
      'undefined',
      'isNaN',
      'isFinite',
      'parseInt',
      'parseFloat',

      // Additional identifiers to whitelist (these will NOT be transformed)
      ...additionalIdentifiers,
    ];

    const transformConfig: TransformConfig = {
      enabled: true,
      mode: 'whitelist', // WHITELIST MODE: Transform everything except whitelisted
      whitelistedIdentifiers,
      prefix,
    };

    transformAst(ast, transformConfig);
  }

  // Step 2: Transform loops (for, for-of, while, do-while)
  if (transformLoops) {
    transformLoopsInAst(ast, prefix);
  }

  // Step 3: Wrap in async function __ag_main() if needed
  if (wrapInMain) {
    ast = wrapInMainFunction(ast);
  }

  // Step 4: Generate code
  return generate(ast);
}

/**
 * Wrap AST in `async function __ag_main() { ... }`
 *
 * @param ast The AST to wrap
 * @returns New AST with code wrapped in __ag_main
 */
function wrapInMainFunction(ast: any): any {
  // Extract the body statements from the Program node
  const bodyStatements = ast.type === 'Program' ? ast.body : [ast];

  // Convert last expression statement to return statement
  // This allows code like `const x = 5; x + 3` to return the value
  if (bodyStatements.length > 0) {
    const lastStatement = bodyStatements[bodyStatements.length - 1];

    // If the last statement is an ExpressionStatement, convert it to ReturnStatement
    if (lastStatement.type === 'ExpressionStatement') {
      bodyStatements[bodyStatements.length - 1] = {
        type: 'ReturnStatement',
        argument: lastStatement.expression,
      };
    }
  }

  // Create the wrapper function
  const wrappedAst: any = {
    type: 'Program',
    sourceType: 'script',
    body: [
      {
        type: 'FunctionDeclaration',
        id: {
          type: 'Identifier',
          name: '__ag_main',
        },
        params: [],
        body: {
          type: 'BlockStatement',
          body: bodyStatements,
        },
        async: true,
        generator: false,
      },
    ],
  };

  return wrappedAst;
}

/**
 * Transform loops in the AST for runtime safety
 *
 * Transformations:
 * - `for (init; test; update) { body }` → `__safe_for(init, test, update, () => { body })`
 * - `for (const x of iterable) { body }` → `for (const x of __safe_forOf(iterable)) { body }`
 * - `while (test) { body }` → `__safe_while(() => test, () => { body })`
 * - `do { body } while (test)` → `__safe_doWhile(() => { body }, () => test)`
 *
 * @param ast The AST to transform
 * @param prefix Prefix for safe functions (default: '__safe_')
 */
function transformLoopsInAst(ast: any, prefix = '__safe_'): void {
  walk.ancestor(ast, {
    // ForStatement: Not transformed in v1 - blocked by validation layer
    // WhileStatement: Not transformed in v1 - blocked by validation layer
    // DoWhileStatement: Not transformed in v1 - blocked by validation layer

    ForOfStatement: (node: any) => {
      // Transform: for (const x of iterable) { ... }
      // → for (const x of __safe_forOf(iterable)) { ... }
      if (node.right) {
        node.right = {
          type: 'CallExpression',
          callee: {
            type: 'Identifier',
            name: `${prefix}forOf`,
          },
          arguments: [node.right],
        };
      }
    },
  });
}

/**
 * Check if code is already wrapped in __ag_main
 *
 * @param code Code to check
 * @returns true if code is already wrapped
 */
export function isWrappedInMain(code: string): boolean {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    if ((ast as any).body.length === 1) {
      const first = (ast as any).body[0];
      return first.type === 'FunctionDeclaration' && first.id && first.id.name === '__ag_main' && first.async === true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract code from __ag_main wrapper (if present)
 *
 * @param code Code that may be wrapped
 * @returns Unwrapped code
 */
export function unwrapFromMain(code: string): string {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }) as any;
    if (ast.body.length === 1) {
      const first = ast.body[0];
      if (
        first.type === 'FunctionDeclaration' &&
        first.id &&
        first.id.name === '__ag_main' &&
        first.async === true &&
        first.body &&
        first.body.type === 'BlockStatement'
      ) {
        // Generate code from the body statements
        const unwrappedAst = {
          type: 'Program',
          sourceType: 'script',
          body: first.body.body,
        };
        return generate(unwrappedAst);
      }
    }
    return code;
  } catch {
    return code;
  }
}
