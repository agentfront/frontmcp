import { canonicalJson } from '@frontmcp/utils';

/** A JSON Schema as the input-schema rule reads it: type, enum, `anyOf`/`oneOf`/`allOf`, properties, required names. */
interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: PropertySchema[];
  oneOf?: PropertySchema[];
  allOf?: PropertySchema[];
}

interface ObjectSchema {
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

/** One argument that does not match the tool's input schema. */
export interface ArgumentIssue {
  argument: string;
  message: string;
  suggestion?: string;
}

function jsonTypesOf(value: unknown): string[] {
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array'];
  if (typeof value === 'number') return Number.isInteger(value) ? ['number', 'integer'] : ['number'];
  return [typeof value];
}

function withArticle(words: string): string {
  return /^[aeiou]/.test(words) ? `an ${words}` : `a ${words}`;
}

/** The types the schema names, its own or else those of its `anyOf`/`oneOf` branches, for the message. */
function expectedTypesOf(schema: PropertySchema): string[] {
  if (schema.type !== undefined) return Array.isArray(schema.type) ? schema.type : [schema.type];
  return (schema.anyOf ?? schema.oneOf ?? []).flatMap(expectedTypesOf);
}

function enumOf(schema: PropertySchema): unknown[] {
  return schema.enum ?? (schema.anyOf ?? schema.oneOf ?? []).flatMap(enumOf);
}

/** Equal as JSON, whatever the order of object members. */
function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/** The schema's own type and enum, and its `anyOf`, `oneOf` (exactly one branch) and `allOf`, all together. */
function matchesSchema(value: unknown, schema: PropertySchema): boolean {
  const ownTypes = schema.type === undefined ? [] : [schema.type].flat();
  if (ownTypes.length > 0 && !jsonTypesOf(value).some((type) => ownTypes.includes(type))) return false;
  if (schema.enum && !schema.enum.some((allowed) => sameJson(allowed, value))) return false;
  if (schema.anyOf && !schema.anyOf.some((branch) => matchesSchema(value, branch))) return false;
  if (schema.oneOf && schema.oneOf.filter((branch) => matchesSchema(value, branch)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every((branch) => matchesSchema(value, branch))) return false;
  return true;
}

/** The literal the agent meant, when a string or a number only has the wrong type. */
function suggestionFor(argument: string, value: unknown, expectedTypes: string[]): string | undefined {
  const wantsNumber = expectedTypes.includes('number') || expectedTypes.includes('integer');
  if (wantsNumber && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return `${argument}: ${Number(value)}`;
  }
  if (expectedTypes.includes('boolean') && (value === 'true' || value === 'false')) {
    return `${argument}: ${value}`;
  }
  if (expectedTypes.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) {
    return `${argument}: ${JSON.stringify(String(value))}`;
  }
  return undefined;
}

function issueOf(argument: string, value: unknown, schema: PropertySchema): ArgumentIssue | undefined {
  if (matchesSchema(value, schema)) return undefined;
  const expectedTypes = expectedTypesOf(schema);
  const actualTypes = jsonTypesOf(value);
  const allowedValues = enumOf(schema);
  const typeMatches = expectedTypes.length === 0 || actualTypes.some((type) => expectedTypes.includes(type));
  if (allowedValues.length > 0 && typeMatches) {
    const allowed = allowedValues.map((option) => JSON.stringify(option)).join(', ');
    return { argument, message: `"${argument}" must be one of ${allowed}` };
  }
  if (typeMatches) return { argument, message: `"${argument}" does not match its schema` };
  const expected = withArticle(expectedTypes.join(' or '));
  const suggestion = suggestionFor(argument, value, expectedTypes);
  return {
    argument,
    message: `"${argument}" must be ${expected}, not ${withArticle(actualTypes[0])}`,
    ...(suggestion ? { suggestion } : {}),
  };
}

/**
 * The arguments of a call that its tool's input schema refuses, by type and enum. With `complete`, every argument is
 * known, so a missing required one is an issue too; nested schemas are left to the tool's own validation.
 */
export function argumentIssuesOf(
  args: Readonly<Record<string, unknown>>,
  inputSchema: Readonly<Record<string, unknown>> | null,
  complete: boolean,
): ArgumentIssue[] {
  if (!inputSchema) return [];
  const { properties = {}, required = [] } = inputSchema as ObjectSchema;
  const issues: ArgumentIssue[] = [];
  for (const [argument, value] of Object.entries(args)) {
    const propertySchema = properties[argument];
    const issue = propertySchema ? issueOf(argument, value, propertySchema) : undefined;
    if (issue) issues.push(issue);
  }
  if (!complete) return issues;
  for (const argument of required) {
    if (!(argument in args)) issues.push({ argument, message: `"${argument}" is required` });
  }
  return issues;
}
