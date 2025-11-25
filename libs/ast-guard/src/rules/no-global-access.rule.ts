import type { ValidationRule, ValidationContext } from '../interfaces';
import { ValidationSeverity } from '../interfaces';
import * as walk from 'acorn-walk';

/**
 * Configuration options for NoGlobalAccessRule
 */
export interface NoGlobalAccessOptions {
  /** List of global object names to block access to */
  blockedGlobals?: string[];
  /** Whether to block member access to globals */
  blockMemberAccess?: boolean;
  /** Whether to block computed access to globals */
  blockComputedAccess?: boolean;
}

/**
 * Rule that prevents access to global objects (window, globalThis, this)
 *
 * This blocks attack vectors like:
 * - window['eval']
 * - globalThis.Function
 * - this['constructor']
 * - window[dynamicVar]
 *
 * Rationale: Even with identifier transformation, attackers can access
 * dangerous functions through global object references.
 */
export class NoGlobalAccessRule implements ValidationRule {
  readonly name = 'no-global-access';
  readonly description = 'Prevents access to global objects that can bypass security';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = false;

  private readonly blockedGlobals: Set<string>;
  private readonly blockMemberAccess: boolean;
  private readonly blockComputedAccess: boolean;

  constructor(options: NoGlobalAccessOptions = {}) {
    this.blockedGlobals = new Set(options.blockedGlobals || ['window', 'globalThis', 'self', 'global', 'this']);
    this.blockMemberAccess = options.blockMemberAccess ?? true;
    this.blockComputedAccess = options.blockComputedAccess ?? true;
  }

  validate(context: ValidationContext): void {
    const { ast, report } = context;

    walk.simple(ast, {
      // Check member expressions: window.eval, globalThis['Function'], this['eval']
      MemberExpression: (node: any) => {
        let objectName: string | null = null;

        // Check for Identifier (window, globalThis, self, global)
        if (node.object && node.object.type === 'Identifier') {
          objectName = node.object.name;
        }
        // Check for ThisExpression (this)
        else if (node.object && node.object.type === 'ThisExpression') {
          objectName = 'this';
        }

        // Check if accessing a blocked global
        if (objectName && this.blockedGlobals.has(objectName)) {
          // Member access: window.eval, globalThis.Function
          if (!node.computed && this.blockMemberAccess) {
            const propertyName = node.property?.type === 'Identifier' ? node.property.name : '(unknown)';
            report({
              code: 'NO_GLOBAL_ACCESS',
              message: `Access to ${objectName}.${propertyName} is not allowed`,
              location: node.object.loc
                ? {
                    line: node.object.loc.start.line,
                    column: node.object.loc.start.column,
                  }
                : undefined,
              data: {
                global: objectName,
                property: propertyName,
                accessType: 'member',
              },
            });
          }

          // Computed access: window['eval'], globalThis[someVar]
          if (node.computed && this.blockComputedAccess) {
            const propertyName =
              node.property.type === 'Literal'
                ? String(node.property.value)
                : node.property.type === 'Identifier'
                ? node.property.name
                : '(dynamic)';

            report({
              code: 'NO_GLOBAL_ACCESS',
              message: `Computed access to ${objectName}[${propertyName}] is not allowed`,
              location: node.object.loc
                ? {
                    line: node.object.loc.start.line,
                    column: node.object.loc.start.column,
                  }
                : undefined,
              data: {
                global: objectName,
                property: propertyName,
                accessType: 'computed',
              },
            });
          }
        }

        // Check for .constructor access (bypasses Function restriction)
        if (
          node.property &&
          ((node.property.type === 'Identifier' && node.property.name === 'constructor') ||
            (node.property.type === 'Literal' && node.property.value === 'constructor'))
        ) {
          report({
            code: 'NO_CONSTRUCTOR_ACCESS',
            message: 'Access to .constructor property is not allowed',
            location: node.property.loc
              ? {
                  line: node.property.loc.start.line,
                  column: node.property.loc.start.column,
                }
              : undefined,
            data: {
              property: 'constructor',
            },
          });
        }
      },

      // Check destructuring from globals: const { eval } = window
      VariableDeclarator: (node: any) => {
        if (node.init && node.init.type === 'Identifier') {
          const sourceName = node.init.name;

          // Check if destructuring from a blocked global
          if (this.blockedGlobals.has(sourceName)) {
            if (node.id.type === 'ObjectPattern') {
              const properties = node.id.properties
                .map((prop: any) => {
                  if (prop.type === 'Property' && prop.key.type === 'Identifier') {
                    return prop.key.name;
                  }
                  return '(unknown)';
                })
                .join(', ');

              report({
                code: 'NO_GLOBAL_DESTRUCTURE',
                message: `Destructuring from ${sourceName} is not allowed: { ${properties} }`,
                location: node.init.loc
                  ? {
                      line: node.init.loc.start.line,
                      column: node.init.loc.start.column,
                    }
                  : undefined,
                data: {
                  global: sourceName,
                  properties,
                },
              });
            }
          }
        }
      },

      // Check for Reflect API usage
      CallExpression: (node: any) => {
        if (
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Reflect'
        ) {
          const methodName = node.callee.property.type === 'Identifier' ? node.callee.property.name : '(unknown)';

          report({
            code: 'NO_REFLECT_API',
            message: `Use of Reflect.${methodName}() is not allowed`,
            location: node.callee.loc
              ? {
                  line: node.callee.loc.start.line,
                  column: node.callee.loc.start.column,
                }
              : undefined,
            data: {
              api: 'Reflect',
              method: methodName,
            },
          });
        }

        // Check for Object.getOwnPropertyDescriptor and similar
        if (
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Object' &&
          node.callee.property.type === 'Identifier'
        ) {
          const dangerousMethods = [
            'getOwnPropertyDescriptor',
            'getOwnPropertyDescriptors',
            'getPrototypeOf',
            'setPrototypeOf',
            'defineProperty',
            'defineProperties',
            'create', // Can create objects with arbitrary prototypes
          ];

          const methodName = node.callee.property.name;

          if (dangerousMethods.includes(methodName)) {
            report({
              code: 'NO_META_PROGRAMMING',
              message: `Use of Object.${methodName}() is not allowed`,
              location: node.callee.loc
                ? {
                    line: node.callee.loc.start.line,
                    column: node.callee.loc.start.column,
                  }
                : undefined,
              data: {
                api: 'Object',
                method: methodName,
              },
            });
          }
        }
      },
    });
  }
}
