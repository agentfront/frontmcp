// file: libs/sdk/src/transport/session-mode.check.ts

/** Transport configs already warned about (one server's config is shared by all its scopes). */
const warned = new WeakSet<object>();

/**
 * Warn at startup when `transport.sessionMode` asks for something the server does not do.
 *
 * Nothing reads `sessionMode` since v1.0: whether the server keeps sessions follows
 * `transport.protocol` (`'stateless-api'` serves without sessions). The option is still accepted, so
 * `sessionMode: 'stateless'` (or a function) used to be silently ignored (#678). `'stateful'`, the
 * default, matches what the session-based protocols do and is left alone.
 */
export function warnIfSessionModeIgnored(options: {
  logger: { warn(message: string): void };
  transport?: { sessionMode?: unknown; protocol?: unknown };
}): void {
  const { transport } = options;
  const mode = transport?.sessionMode;
  if (!transport || mode === undefined || mode === 'stateful' || warned.has(transport)) return;
  warned.add(transport);

  const shown = typeof mode === 'function' ? 'a function' : `'${String(mode)}'`;
  const advice =
    transport.protocol === 'stateless-api'
      ? "The server already serves without sessions (`transport.protocol: 'stateless-api'`); remove `sessionMode`."
      : "To serve without sessions, set `transport.protocol: 'stateless-api'` and remove `sessionMode`.";
  options.logger.warn(`transport.sessionMode (${shown}) is ignored: sessions follow \`transport.protocol\`. ${advice}`);
}
