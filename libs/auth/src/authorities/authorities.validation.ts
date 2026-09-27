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

/** A problem for each key of `value` that isn't one of `known`. */
function unknownFields(value: Record<string, unknown>, known: ReadonlySet<string>, path: string): string[] {
  const prefix = path ? `${path} has` : 'has';
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => `${prefix} an unknown field "${key}"`);
}

/** A non-empty list of non-empty names (`roles.all`, `permissions.any`...). */
function checkStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be a list of names`];
  if (value.length === 0) return [`${path} is empty`];
  return value.every(isNonEmptyString) ? [] : [`${path} must contain only non-empty names`];
}

const ALL_OR_ANY: ReadonlySet<string> = new Set(['all', 'any']);

/** `{ all?, any? }` for roles and permissions: at least one of them, each a non-empty list of names. */
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

/** An object naming `fromInput` or `fromClaims`, which the evaluator resolves at run time. */
function isValueReference(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && ('fromInput' in value || 'fromClaims' in value);
}

/** A `{ fromInput }` / `{ fromClaims }` reference names exactly one non-empty source. */
function checkValueReference(value: Record<string, unknown>, path: string): string[] {
  const ref = value['fromInput'] ?? value['fromClaims'];
  return Object.keys(value).length === 1 && isNonEmptyString(ref)
    ? []
    : [`${path} must be { fromInput: "<name>" } or { fromClaims: "<path>" }`];
}

/** What each operator's literal `value` must be for the comparison to mean anything. */
const OPERATOR_VALUES: Partial<Record<AbacOperator, { accepts: (value: unknown) => boolean; needs: string }>> = {
  in: { accepts: Array.isArray, needs: 'a list' },
  notIn: { accepts: Array.isArray, needs: 'a list' },
  gt: { accepts: (value) => typeof value === 'number', needs: 'a number' },
  gte: { accepts: (value) => typeof value === 'number', needs: 'a number' },
  lt: { accepts: (value) => typeof value === 'number', needs: 'a number' },
  lte: { accepts: (value) => typeof value === 'number', needs: 'a number' },
  startsWith: { accepts: (value) => typeof value === 'string', needs: 'a string' },
  endsWith: { accepts: (value) => typeof value === 'string', needs: 'a string' },
  matches: { accepts: (value) => typeof value === 'string', needs: 'a string' },
};

/**
 * A condition's `value` is what the evaluator compares against, and a missing or unusable one
 * does not simply fail: `exists` with no value admits every caller without the attribute, `neq`
 * with no value or `notIn: []` admit nearly everyone, and under `not` any failing condition grants.
 * So every condition needs one the operator can use.
 */
function checkConditionValue(op: AbacOperator, condition: Record<string, unknown>, path: string): string[] {
  const value = condition['value'];
  if (value === undefined) return [`${path} is missing`];
  if (op === 'exists') {
    return typeof value === 'boolean' ? [] : [`${path} must be true or false for "exists"`];
  }
  if (isValueReference(value)) return checkValueReference(value, path);
  const expected = OPERATOR_VALUES[op];
  if (expected && !expected.accepts(value)) return [`${path} must be ${expected.needs} for "${op}"`];
  if (Array.isArray(value) && value.length === 0 && (op === 'in' || op === 'notIn')) return [`${path} is empty`];
  return [];
}

/** An ABAC policy: a non-empty `match` and/or a non-empty `conditions` list of well-formed conditions. */
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
    else {
      for (const [attribute, expected] of Object.entries(match)) {
        const at = `${path}.match[${JSON.stringify(attribute)}]`;
        if (expected === undefined) problems.push(`${at} has no value`);
        else if (isValueReference(expected)) problems.push(...checkValueReference(expected, at));
      }
    }
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
        const op = condition['op'] as AbacOperator;
        if (!ABAC_OPERATORS.has(op)) {
          problems.push(`${at}.op "${String(condition['op'])}" is not an operator`);
        } else {
          problems.push(...checkConditionValue(op, condition, `${at}.value`));
        }
      });
    }
  }
  return problems;
}

const RELATIONSHIP_FIELDS: ReadonlySet<string> = new Set(['type', 'resource', 'resourceId']);

/** A ReBAC resource id: a literal string or a `{ fromInput }` / `{ fromClaims }` reference. */
function checkResourceId(value: unknown, path: string): string[] {
  if (isNonEmptyString(value)) return [];
  if (isPlainObject(value) && Object.keys(value).length === 1) {
    const ref = value['fromInput'] ?? value['fromClaims'];
    if (isNonEmptyString(ref)) return [];
  }
  return [`${path} must be a string, { fromInput } or { fromClaims }`];
}

/** One ReBAC relationship: `type`, `resource` and `resourceId`, and nothing else. */
function checkRelationship(value: unknown, path: string): string[] {
  if (!isPlainObject(value)) return [`${path} must be an object with "type", "resource" and "resourceId"`];
  const problems = unknownFields(value, RELATIONSHIP_FIELDS, path);
  if (!isNonEmptyString(value['type'])) problems.push(`${path}.type must be a non-empty string`);
  if (!isNonEmptyString(value['resource'])) problems.push(`${path}.resource must be a non-empty string`);
  problems.push(...checkResourceId(value['resourceId'], `${path}.resourceId`));
  return problems;
}

/** One relationship, or a non-empty list of them (all must hold). */
function checkRelationships(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return checkRelationship(value, path);
  if (value.length === 0) return [`${path} is empty`];
  return value.flatMap((relationship, index) => checkRelationship(relationship, `${path}[${index}]`));
}

/** The rules of an `allOf` / `anyOf`: a non-empty list of rule objects (not profile names). */
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
