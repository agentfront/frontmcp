/**
 * A client the application passed in stays the application's: FrontMCP may run commands on it and
 * open copies of it, but must never close it (#1503). The guard below makes that hold for every
 * feature, including the ones that "quit their client" on shutdown.
 */
/** The methods that close a connection, across ioredis (`quit`, `disconnect`) and node-redis (`close`, `destroy`). */
const CLOSING_METHODS = new Set<PropertyKey>(['quit', 'disconnect', 'close', 'destroy', 'QUIT']);

const BORROWED = Symbol.for('frontmcp.redis.borrowed');

/** Whether `client` is a guard from {@link borrowRedisClient}. */
export function isBorrowedRedisClient(client: unknown): boolean {
  return typeof client === 'object' && client !== null && (client as Record<symbol, unknown>)[BORROWED] === true;
}

/**
 * `client`, with its closing methods turned into no-ops. Every other property is the client's own,
 * and its methods run with the client itself as `this`, so its internals see no difference.
 * `duplicate()` returns the real copy, which belongs to whoever asked for it.
 */
export function borrowRedisClient<T extends object>(client: T): T {
  if (isBorrowedRedisClient(client)) return client;
  return new Proxy(client, {
    get(target, property) {
      if (property === BORROWED) return true;
      if (CLOSING_METHODS.has(property)) {
        return typeof Reflect.get(target, property, target) === 'function' ? closeNothing : undefined;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A closing method of a borrowed client: resolves like ioredis's `quit()` and closes nothing. */
function closeNothing(): Promise<'OK'> {
  return Promise.resolve('OK');
}
