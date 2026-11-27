// file: libs/sdk/src/tool/undeclared-arguments.ts
import { hasTransform } from '@frontmcp/lazy-zod';

/** A key path as its segments, `[]` standing for the items of an array, so a key named `a.b` stays one segment. */
export type ArgumentKeyPath = readonly string[];

/** The argument key paths parsing dropped, sorted and unique; below a field with a transform none are compared. */
export function findUndeclaredArguments(
  shape: Readonly<Record<string, unknown>>,
  sent: unknown,
  parsed: unknown,
): ArgumentKeyPath[] {
  const dropped = new Map<string, ArgumentKeyPath>();
  const walk = (source: unknown, target: unknown, path: ArgumentKeyPath): void => {
    if (source === target) return;
    if (Array.isArray(source)) {
      source.forEach((item, index) => walk(item, Array.isArray(target) ? target[index] : undefined, [...path, '[]']));
      return;
    }
    if (!isPlainRecord(source)) return;
    const targetRecord = isPlainRecord(target) ? target : {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const keyPath = [...path, key];
      if (!Object.prototype.hasOwnProperty.call(targetRecord, key)) dropped.set(JSON.stringify(keyPath), keyPath);
      else if (path.length > 0 || !hasTransform(shape[key])) walk(value, targetRecord[key], keyPath);
    }
  };
  walk(sent, parsed, []);
  return [...dropped.values()].sort((left, right) => formatKeyPath(left).localeCompare(formatKeyPath(right)));
}

/** The keys declared below `parentPath`: those of every object the schema allows there, `[]` standing for array items. */
export function declaredKeysAt(shape: Readonly<Record<string, unknown>>, parentPath: ArgumentKeyPath): string[] {
  let level: SchemaDefinition[] = [{ type: 'object', shape }];
  for (const segment of parentPath) {
    const next = level.flatMap((definition) => {
      if (segment === '[]') return definition['type'] === 'array' ? definitionsOf(definition['element']) : [];
      const fields = definition['type'] === 'object' ? (definition['shape'] as Record<string, unknown>) : {};
      return Object.prototype.hasOwnProperty.call(fields, segment) ? definitionsOf(fields[segment]) : [];
    });
    // Each definition once: two options whose field holds the same schema would otherwise double it at each segment.
    level = [...new Set(next)];
  }
  const keys = level.flatMap((definition) =>
    definition['type'] === 'object' ? Object.keys(definition['shape'] as Record<string, unknown>) : [],
  );
  return [...new Set(keys)];
}

type SchemaDefinition = Record<string, unknown>;

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'nonoptional', 'readonly', 'catch']);

/** What `schema` can be below its wrappers (optional, default, ...): each union option, both sides of an intersection. */
function definitionsOf(schema: unknown, seen = new Set<object>()): SchemaDefinition[] {
  const definition = (schema as { _zod?: { def?: SchemaDefinition } } | null | undefined)?._zod?.def;
  if (!definition || seen.has(definition)) return [];
  seen.add(definition);
  const type = definition['type'];
  if (typeof type === 'string' && WRAPPER_TYPES.has(type)) return definitionsOf(definition['innerType'], seen);
  if (type === 'lazy') {
    // The schema zod keeps for it, so each time it is expanded it gives the same definitions to deduplicate.
    const inner = (schema as { _zod: { innerType?: unknown } })._zod.innerType;
    return definitionsOf(inner ?? (definition['getter'] as () => unknown)(), seen);
  }
  if (type === 'union') return (definition['options'] as unknown[]).flatMap((option) => definitionsOf(option, seen));
  if (type === 'intersection') {
    return [definition['left'], definition['right']].flatMap((side) => definitionsOf(side, seen));
  }
  return [definition];
}

/** A key path as people read it: `filter.owner`, `lines[].margin`. */
export function formatKeyPath(keyPath: ArgumentKeyPath): string {
  return keyPath.reduce(
    (text, segment) => (segment === '[]' ? `${text}[]` : text ? `${text}.${segment}` : segment),
    '',
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
