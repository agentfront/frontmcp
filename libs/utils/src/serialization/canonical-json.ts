/** Deterministic JSON: object keys sorted, arrays in order, `undefined` members dropped; a non-JSON value throws. */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

function refuse(description: string): never {
  throw new TypeError(`canonicalJson: ${description} is not a JSON value`);
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : refuse(String(value));
  if (typeof value !== 'object') return refuse(typeof value);
  if (ancestors.has(value)) return refuse('a circular reference');

  ancestors.add(value);
  const text = serializeObject(value, ancestors);
  ancestors.delete(value);
  return text;
}

function serializeObject(value: object, ancestors: Set<object>): string {
  if (hasToJson(value)) return serialize(value.toJSON(), ancestors);
  if (Array.isArray(value)) return `[${Array.from(value, (item) => serialize(item, ancestors)).join(',')}]`;
  if (!isPlainObject(value)) return refuse('a class instance');

  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`);
  return `{${members.join(',')}}`;
}

function hasToJson(value: object): value is { toJSON(): unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function';
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
