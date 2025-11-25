import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';
import { RuleConfigurationError } from '../errors';

/**
 * Options for DisallowedIdentifierRule
 */
export interface DisallowedIdentifierOptions {
  /** List of identifier names that are not allowed */
  disallowed: string[];
  /** Custom message template (use {identifier} placeholder) */
  messageTemplate?: string;
}

/**
 * Rule that prevents usage of specific identifiers
 *
 * Useful for blocking access to dangerous globals or built-ins like:
 * - eval
 * - Function
 * - process
 * - require
 * - etc.
 */
export class DisallowedIdentifierRule implements ValidationRule {
  readonly name = 'disallowed-identifier';
  readonly description = 'Prevents usage of disallowed identifiers';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  constructor(private options: DisallowedIdentifierOptions) {
    if (!options.disallowed || options.disallowed.length === 0) {
      throw new RuleConfigurationError(
        'DisallowedIdentifierRule requires at least one disallowed identifier',
        'disallowed-identifier',
      );
    }
  }

  validate(context: ValidationContext): void {
    const disallowedSet = new Set(this.options.disallowed);
    const messageTemplate = this.options.messageTemplate || 'Access to "{identifier}" is not allowed';

    walk.simple(context.ast as any, {
      Identifier: (node: any) => {
        if (disallowedSet.has(node.name)) {
          context.report({
            code: 'DISALLOWED_IDENTIFIER',
            message: messageTemplate.replace('{identifier}', node.name),
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
            data: { identifier: node.name },
          });
        }
      },
      MemberExpression: (node: any) => {
        // Check property name in member expressions
        // e.g., obj.constructor or obj['constructor']
        let propertyName: string | undefined;

        if (node.property) {
          if (node.property.type === 'Identifier' && !node.computed) {
            // obj.constructor
            propertyName = node.property.name;
          } else if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
            // obj['constructor']
            propertyName = node.property.value;
          }
        }

        if (propertyName && disallowedSet.has(propertyName)) {
          context.report({
            code: 'DISALLOWED_IDENTIFIER',
            message: messageTemplate.replace('{identifier}', propertyName),
            location: node.property.loc
              ? {
                  line: node.property.loc.start.line,
                  column: node.property.loc.start.column,
                }
              : undefined,
            data: { identifier: propertyName },
          });
        }
      },
    });
  }
}
