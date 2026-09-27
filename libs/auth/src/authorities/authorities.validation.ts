/**
 * Structural validation for authorities rules.
 *
 * The engine evaluates only the fields it knows, so a rule that names no known check
 * (`{}`, `{ roles: {} }`, `allOf: []`, a misspelled `role:`) used to grant everyone.
 * These helpers find such rules so the server can refuse them when it starts, and the
 * engine can deny them when they are evaluated anyway.
 */

import type { AbacOperator, AuthoritiesPolicyMetadata } from './authorities.types';

const ABAC_OPERATORS: ReadonlySet<AbacOperator> = new Set<AbacOperator>([
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'exists',
  'matches',
]);

/** Fields of a rule that check something about the caller. */
const CHECK_FIELDS = [
  'roles',
  'permissions',
  'attributes',
  'relationships',
  'custom',
  'guards',
  'allOf',
  'anyOf',
  'not',
] as const satisfies ReadonlyArray<keyof AuthoritiesPolicyMetadata>;

const RULE_FIELDS: ReadonlySet<string> = new Set<string>([...CHECK_FIELDS, 'operator']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function unknownFields(value: Record<string, unknown>, known: ReadonlySet<string>, path: string): string[] {
  const prefix = path ? `${path} has` : 'has';
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => `${prefix} an unknown field "${key}"`);
}

function checkStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be a list of names`];
  if (value.length === 0) return [`${path} is empty`];
  return value.every(isNonEmptyString) ? [] : [`${path} must contain only non-empty names`];
}

const ALL_OR_ANY: ReadonlySet<string> = new Set(['all', 'any']);

function checkAllOrAny(value: unknown, path: string): string[] {
  if (!isPlainObject(value)) return [`${path} must be an object with "all" or "any"`];
  const problems = unknownFields(value, ALL_OR_ANY, path);
  if (value['all'] === undefined && value['any'] === undefined) {
    problems.push(`${path} needs "all" or "any"`);
  }
  if (value['all'] !== undefined) problems.push(...checkStringList(value['all'], `${path}.all`));
  if (value['any'] !== undefined) problems.push(...checkStringList(value['any'], `${path}.any`));
  return problems;
}

const ATTRIBUTE_FIELDS: ReadonlySet<string> = new Set(['match', 'conditions']);
const CONDITION_FIELDS: ReadonlySet<string> = new Set(['path', 'op', 'value']);

function checkAttributes(value: unknown, path: string): string[] {
  if (!isPlainObject(value)) return [`${path} must be an object with "match" or "conditions"`];
  const problems = unknownFields(value, ATTRIBUTE_FIELDS, path);
  const { match, conditions } = value;
  if (match === undefined && conditions === undefined) {
    problems.push(`${path} needs "match" or "conditions"`);
  }
  if (match !== undefined) {
    if (!isPlainObject(match)) problems.push(`${path}.match must be an object`);
    else if (Object.keys(match).length === 0) problems.push(`${path}.match is empty`);
  }
  if (conditions !== undefined) {
    if (!Array.isArray(conditions)) problems.push(`${path}.conditions must be a list`);
    else if (conditions.length === 0) problems.push(`${path}.conditions is empty`);
    else {
      conditions.forEach((condition, index) => {
        const at = `${path}.conditions[${index}]`;
        if (!isPlainObject(condition)) {
          problems.push(`${at} must be an object with "path" and "op"`);
          return;
        }
        problems.push(...unknownFields(condition, CONDITION_FIELDS, at));
        if (!isNonEmptyString(condition['path'])) problems.push(`${at}.path must be a non-empty string`);
        if (!ABAC_OPERATORS.has(condition['op'] as AbacOperator)) {
          problems.push(`${at}.op "${String(condition['op'])}" is not an operator`);
        }
      });
    }
  }
  return problems;
}

const RELATIONSHIP_FIELDS: ReadonlySet<string> = new Set(['type', 'resource', 'resourceId']);

function checkResourceId(value: unknown, path: string): string[] {
  if (isNonEmptyString(value)) return [];
  if (isPlainObject(value) && Object.keys(value).length === 1) {
    const ref = value['fromInput'] ?? value['fromClaims'];
    if (isNonEmptyString(ref)) return [];
  }
  return [`${path} must be a string, { fromInput } or { fromClaims }`];
}

function checkRelationship(value: unknown, path: string): string[] {
  if (!isPlainObject(value)) return [`${path} must be an object with "type", "resource" and "resourceId"`];
  const problems = unknownFields(value, RELATIONSHIP_FIELDS, path);
  if (!isNonEmptyString(value['type'])) problems.push(`${path}.type must be a non-empty string`);
  if (!isNonEmptyString(value['resource'])) problems.push(`${path}.resource must be a non-empty string`);
  problems.push(...checkResourceId(value['resourceId'], `${path}.resourceId`));
  return problems;
}

function checkRelationships(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return checkRelationship(value, path);
  if (value.length === 0) return [`${path} is empty`];
  return value.flatMap((relationship, index) => checkRelationship(relationship, `${path}[${index}]`));
}

function checkRuleList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be a list of rules`];
  if (value.length === 0) return [`${path} is empty`];
  return value.flatMap((rule, index) => checkRule(rule, `${path}[${index}]`));
}

/**
 * Problems with one rule object. `path` is where the rule sits ('' for the top level),
 * so each problem reads like `.allOf[0].roles needs "all" or "any"`.
 */
function checkRule(rule: unknown, path: string): string[] {
  if (!isPlainObject(rule)) {
    return [`${path || 'the rule'} must be a rule object${typeof rule === 'string' ? ', not a profile name' : ''}`];
  }

  const problems = unknownFields(rule, RULE_FIELDS, path);
  if (!CHECK_FIELDS.some((field) => rule[field] !== undefined)) {
    problems.push(`${path ? `${path} ` : ''}checks nothing`);
  }

  if (rule['operator'] !== undefined && rule['operator'] !== 'AND' && rule['operator'] !== 'OR') {
    problems.push(`${path}.operator must be "AND" or "OR"`);
  }
  if (rule['roles'] !== undefined) problems.push(...checkAllOrAny(rule['roles'], `${path}.roles`));
  if (rule['permissions'] !== undefined) problems.push(...checkAllOrAny(rule['permissions'], `${path}.permissions`));
  if (rule['attributes'] !== undefined) problems.push(...checkAttributes(rule['attributes'], `${path}.attributes`));
  if (rule['relationships'] !== undefined) {
    problems.push(...checkRelationships(rule['relationships'], `${path}.relationships`));
  }
  if (rule['custom'] !== undefined) {
    if (!isPlainObject(rule['custom'])) problems.push(`${path}.custom must be an object`);
    else if (Object.keys(rule['custom']).length === 0) problems.push(`${path}.custom is empty`);
  }
  if (rule['guards'] !== undefined) {
    const guards = rule['guards'];
    if (!Array.isArray(guards)) problems.push(`${path}.guards must be a list of functions`);
    else if (guards.length === 0) problems.push(`${path}.guards is empty`);
    else if (!guards.every((guard) => typeof guard === 'function')) {
      problems.push(`${path}.guards must contain only functions`);
    }
  }
  if (rule['allOf'] !== undefined) problems.push(...checkRuleList(rule['allOf'], `${path}.allOf`));
  if (rule['anyOf'] !== undefined) problems.push(...checkRuleList(rule['anyOf'], `${path}.anyOf`));
  if (rule['not'] !== undefined) problems.push(...checkRule(rule['not'], `${path}.not`));
  return problems;
}

/**
 * Find what is wrong with an `authorities` value: a profile name, a list of profile names,
 * or a rule object. Returns an empty list when the value checks something everywhere.
 *
 * A rule object must name at least one check (roles, permissions, attributes, relationships,
 * custom, guards, allOf, anyOf or not), use only known fields, and leave no check empty;
 * combinators hold rule objects, not profile names.
 *
 * @example
 * findAuthoritiesRuleProblems({ role: { any: ['admin'] } });
 * // ['has an unknown field "role"', 'checks nothing']
 */
export function findAuthoritiesRuleProblems(authorities: unknown): string[] {
  if (typeof authorities === 'string') {
    return authorities.length > 0 ? [] : ['the profile name is empty'];
  }
  if (Array.isArray(authorities)) {
    if (authorities.length === 0) return ['the list of profiles is empty'];
    return authorities.every(isNonEmptyString) ? [] : ['a list of profiles must contain only non-empty profile names'];
  }
  if (!isPlainObject(authorities)) {
    return ['must be a profile name, a list of profile names, or a rule object'];
  }
  return checkRule(authorities, '');
}

/**
 * Same as {@link findAuthoritiesRuleProblems}, for a named profile's rule. Problems read
 * `profile "<name>": <problem>`.
 */
export function findAuthoritiesProfileProblems(name: string, policy: unknown): string[] {
  return checkRule(policy, '').map((problem) => `profile "${name}": ${problem.replace(/^\./, '')}`);
}
