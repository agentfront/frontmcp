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
