import type * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { generate } from 'astring';
import type { TransformConfig } from './interfaces';

/**
 * JavaScript keywords that should never be transformed
 * These are reserved words and language constructs
 */
const JS_KEYWORDS = new Set([
  // Reserved keywords
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',

  // Literals
  'null',
  'true',
  'false',
  'undefined',

  // Special identifiers that are not really identifiers
  'arguments',
]);

/**
 * Recursively collect all binding identifiers from patterns (destructuring, etc.)
 *
 * Handles:
 * - Identifier: `const x = ...`
 * - ObjectPattern: `const { a, b } = ...`
 * - ArrayPattern: `const [a, b] = ...`
 * - AssignmentPattern: `const { a = defaultVal } = ...`
 * - RestElement: `const { ...rest } = ...` or `const [...rest] = ...`
 *
 * @param pattern The pattern node to collect identifiers from
 * @param identifiers Set to add collected identifier names to
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- acorn doesn't export specific pattern node types
function collectPatternIdentifiers(pattern: any, identifiers: Set<string>): void {
  if (!pattern) return;

  switch (pattern.type) {
    case 'Identifier':
      identifiers.add(pattern.name);
      break;

    case 'ObjectPattern':
      if (pattern.properties) {
        for (const prop of pattern.properties) {
          if (prop.type === 'Property') {
            // { key: value } - the value is the binding
            collectPatternIdentifiers(prop.value, identifiers);
          } else if (prop.type === 'RestElement') {
            // { ...rest }
            collectPatternIdentifiers(prop.argument, identifiers);
          }
        }
      }
      break;

    case 'ArrayPattern':
      if (pattern.elements) {
        for (const elem of pattern.elements) {
          if (elem) {
            collectPatternIdentifiers(elem, identifiers);
          }
        }
      }
      break;

    case 'AssignmentPattern':
      // { a = defaultValue } - the left side is the binding
      collectPatternIdentifiers(pattern.left, identifiers);
      break;

    case 'RestElement':
      // [...rest] or { ...rest }
      collectPatternIdentifiers(pattern.argument, identifiers);
      break;
  }
}

/**
 * Determine if an identifier should be transformed
 *
 * @param identifierName The identifier name to check
 * @param mode Transformation mode ('blacklist' or 'whitelist')
 * @param targetSet Set of identifiers (blacklist or whitelist depending on mode)
 * @returns true if the identifier should be transformed
 */
function shouldTransformIdentifier(
  identifierName: string,
  mode: 'blacklist' | 'whitelist',
  targetSet: Set<string>,
): boolean {
  // Never transform JavaScript keywords
  if (JS_KEYWORDS.has(identifierName)) {
    return false;
  }

  if (mode === 'blacklist') {
    // Blacklist mode: Transform ONLY if in the list
    return targetSet.has(identifierName);
  } else {
    // Whitelist mode: Transform EVERYTHING except whitelisted identifiers
    return !targetSet.has(identifierName);
  }
}

/**
 * Transform AST by prefixing identifiers based on mode
 *
 * **Blacklist Mode (default):**
 * Transforms only identifiers specified in the list:
 *   console.log('hello');  →  __safe_console.log('hello');
 *   obj['eval']();         →  obj['__safe_eval']();
 *
 * **Whitelist Mode:**
 * Transforms ALL identifiers except those in the whitelist:
 *   const data = users.filter(u => u.active);
 *   →  const __safe_data = __safe_users.filter(__safe_u => __safe_u.active);
 *   (assuming 'users' is whitelisted, but 'data', 'u', 'filter' are not)
 *
 * @param ast The AST to transform (will be mutated in place)
 * @param config Transformation configuration
 */
export function transformAst(ast: acorn.Node, config: TransformConfig): void {
  if (!config.enabled) {
    return;
  }

  const mode = config.mode || 'blacklist';
  const prefix = config.prefix || '__safe_';

  // Build the target set based on mode
  let targetSet: Set<string>;
  if (mode === 'blacklist') {
    targetSet = new Set(config.identifiers || []);
    if (targetSet.size === 0) {
      return; // Nothing to transform in blacklist mode
    }
  } else {
    // Whitelist mode: Build set of identifiers NOT to transform
    targetSet = new Set(config.whitelistedIdentifiers || []);
    // Always add JS keywords to whitelist
    JS_KEYWORDS.forEach((kw) => targetSet.add(kw));
  }

  // Track locally-declared variables for whitelist mode
  // In whitelist mode, we should NOT transform references to locally-declared variables
  const localBindings = new Set<string>();

  if (mode === 'whitelist') {
    // First pass: collect all locally-declared identifiers
    // This includes destructuring patterns (ObjectPattern, ArrayPattern, etc.)
    walk.simple(ast, {
      VariableDeclarator: (node: any) => {
        // Use collectPatternIdentifiers to handle all patterns including destructuring
        collectPatternIdentifiers(node.id, localBindings);
      },
      FunctionDeclaration: (node: any) => {
        if (node.id && node.id.type === 'Identifier') {
          localBindings.add(node.id.name);
        }
        // Add function parameters (including destructuring)
        if (node.params) {
          node.params.forEach((param: any) => {
            collectPatternIdentifiers(param, localBindings);
          });
        }
      },
      FunctionExpression: (node: any) => {
        if (node.id && node.id.type === 'Identifier') {
          localBindings.add(node.id.name);
        }
        // Add function parameters (including destructuring)
        if (node.params) {
          node.params.forEach((param: any) => {
            collectPatternIdentifiers(param, localBindings);
          });
        }
      },
      ArrowFunctionExpression: (node: any) => {
        // Add arrow function parameters (including destructuring)
        if (node.params) {
          node.params.forEach((param: any) => {
            collectPatternIdentifiers(param, localBindings);
          });
        }
      },
      CatchClause: (node: any) => {
        // Add catch clause parameter (including destructuring)
        if (node.param) {
          collectPatternIdentifiers(node.param, localBindings);
        }
      },
      // For-in / For-of loop variables
      ForInStatement: (node: any) => {
        if (node.left.type === 'VariableDeclaration') {
          node.left.declarations.forEach((decl: any) => {
            collectPatternIdentifiers(decl.id, localBindings);
          });
        }
      },
      ForOfStatement: (node: any) => {
        if (node.left.type === 'VariableDeclaration') {
          node.left.declarations.forEach((decl: any) => {
            collectPatternIdentifiers(decl.id, localBindings);
          });
        }
      },
    });
  }

  // Walk the AST and transform matching identifiers
  // Use walk.ancestor to get parent context
  walk.ancestor(ast, {
    // Transform regular identifiers (e.g., `console` in `console.log()`)
    Identifier: (node: any, ancestors: any[]) => {
      // Skip if this identifier is a property name (not a value)
      // Example: { name: 'value' } - 'name' is a property, shouldn't be transformed
      if (ancestors.length > 1) {
        const parent = ancestors[ancestors.length - 2];

        // Don't transform property names in object literals
        if (parent.type === 'Property' && parent.key === node && !parent.computed) {
          return;
        }

        // Don't transform method names in class/object definitions
        if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) {
          return;
        }

        // Don't transform import/export names
        if (parent.type === 'ImportSpecifier' || parent.type === 'ExportSpecifier') {
          return;
        }

        // Don't transform function parameter names or variable declarations
        // These are declarations, not references
        if (
          parent.type === 'FunctionDeclaration' ||
          parent.type === 'FunctionExpression' ||
          parent.type === 'ArrowFunctionExpression'
        ) {
          // Check if this is a param name
          if (parent.params && parent.params.includes(node)) {
            return;
          }
        }

        if (parent.type === 'VariableDeclarator' && parent.id === node) {
          return;
        }

        // Don't transform identifiers in destructuring binding positions
        // For { a } or { a: b }, the binding is 'a' (shorthand) or 'b' (with alias)
        if (parent.type === 'Property' && parent.value === node) {
          // Check if this Property is inside an ObjectPattern (destructuring)
          if (ancestors.length > 2) {
            const grandparent = ancestors[ancestors.length - 3];
            if (grandparent.type === 'ObjectPattern') {
              return;
            }
          }
        }

        // Don't transform identifiers directly in ArrayPattern
        if (parent.type === 'ArrayPattern') {
          return;
        }

        // Don't transform RestElement arguments (e.g., ...rest)
        if (parent.type === 'RestElement' && parent.argument === node) {
          return;
        }

        // Don't transform AssignmentPattern left side (default values in destructuring)
        if (parent.type === 'AssignmentPattern' && parent.left === node) {
          return;
        }
      }

      // In whitelist mode, don't transform locally-declared variables
      if (mode === 'whitelist' && localBindings.has(node.name)) {
        return;
      }

      if (shouldTransformIdentifier(node.name, mode, targetSet)) {
        node.name = `${prefix}${node.name}`;
      }
    },

    // Transform computed member expressions (e.g., obj['eval'])
    MemberExpression: (node: any) => {
      if (config.transformComputed && node.computed && node.property) {
        // Handle string literals like obj['eval']
        if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
          const propValue = node.property.value;
          if (shouldTransformIdentifier(propValue, mode, targetSet)) {
            const newValue = `${prefix}${propValue}`;
            node.property.value = newValue;
            // Update raw to ensure astring generates correct code
            node.property.raw = `'${newValue}'`;
          }
        }
        // Handle template literals like obj[`eval`]
        else if (node.property.type === 'TemplateLiteral') {
          const templateNode = node.property;
          if (templateNode.quasis && templateNode.quasis.length === 1 && templateNode.expressions.length === 0) {
            const staticValue = templateNode.quasis[0].value.cooked;
            if (staticValue && shouldTransformIdentifier(staticValue, mode, targetSet)) {
              // Replace with prefixed string literal
              node.property = {
                type: 'Literal',
                value: `${prefix}${staticValue}`,
                raw: `'${prefix}${staticValue}'`,
              };
            }
          }
        }
      }
    },
  });
}

/**
 * Generate JavaScript code from an AST
 *
 * @param ast The AST to generate code from
 * @returns Generated JavaScript code
 */
export function generateCode(ast: acorn.Node): string {
  return generate(ast);
}

/**
 * Transform JavaScript code by prefixing identifiers
 *
 * This is a convenience function that combines parsing, transforming, and code generation.
 * For better performance when you already have an AST, use transformAst() directly.
 *
 * @param code JavaScript code to transform
 * @param config Transformation configuration
 * @param ast Optional pre-parsed AST (if not provided, code will be parsed)
 * @returns Transformed JavaScript code
 */
export function transformCode(code: string, config: TransformConfig, ast?: acorn.Node): string {
  if (!config.enabled) {
    return code;
  }

  if (!ast) {
    throw new Error('transformCode requires a pre-parsed AST. Use JSAstValidator.validate() instead.');
  }

  // Transform the AST in place
  transformAst(ast, config);

  // Generate code from transformed AST
  return generateCode(ast);
}
