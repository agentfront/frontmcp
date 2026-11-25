/**
 * The idempotency key of a tool call, carried on the call context an in-process dispatcher passes to
 * `tools:call-tool`. A symbol, so no request a client sends can carry it.
 */
const IDEMPOTENCY_KEY = Symbol('frontmcp.tool.idempotency-key');

/**
 * The call context `ctx`, marked with the key the tool it runs reads as `this.idempotencyKey`. For a dispatcher that
 * replays calls, such as CodeCall: the key stays the same each time the same call is replayed, and differs for every
 * other call. The mark is not enumerable, so it is never logged, serialized or copied with the context.
 */
export function withIdempotencyKey<T extends object>(ctx: T, key: string): T {
  return Object.defineProperty(ctx, IDEMPOTENCY_KEY, { value: key, enumerable: false });
}

/** @internal The key {@link withIdempotencyKey} marked the call context with. */
export function idempotencyKeyOf(ctx: unknown): string | undefined {
  if (typeof ctx !== 'object' || ctx === null) return undefined;
  const key: unknown = Reflect.get(ctx, IDEMPOTENCY_KEY);
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}
