// The HTTP handlers FrontMCP registers itself (#948). They read and write requests only through `ServerRequest` and
// `ServerResponse`, so the node:http host can serve them without Express; any other handler gets the Express app.

const sdkHandlers = new WeakSet<object>();

/** Marks `handler` as one of FrontMCP's own, served by the node:http host when every handler of a server is. */
export function sdkHttpHandler<T extends (...args: never[]) => unknown>(handler: T): T {
  sdkHandlers.add(handler);
  return handler;
}

export function isSdkHttpHandler(handler: unknown): boolean {
  return typeof handler === 'function' && sdkHandlers.has(handler);
}
