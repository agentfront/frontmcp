// file: libs/sdk/src/transport/session-mode.check.ts

/** Configs already warned about (one server's config is shared by all its scopes). */
const warned = new WeakSet<object>();

const REMOVAL = 'is ignored and will be removed in the next major';

/** How a `sessionMode` value reads in a warning. */
function describeMode(mode: unknown): string {
  return typeof mode === 'function' ? 'a function' : `'${String(mode)}'`;
}

/** What to do instead, given the protocol the server already serves. */
function protocolAdvice(protocol: unknown, remove: string): string {
  return protocol === 'stateless-api'
    ? `The server already serves without sessions (\`transport.protocol: 'stateless-api'\`); remove \`${remove}\`.`
    : `To serve without sessions, set \`transport.protocol: 'stateless-api'\` and remove \`${remove}\`.`;
}

/**
 * Warn at startup when a session option asks for something the server does not do (#678, #702).
 *
 * - `transport.sessionMode`: nothing reads it since v1.0 — whether the server keeps sessions follows
 *   `transport.protocol` (`'stateless-api'` serves without sessions). `'stateless'` (or a function)
 *   used to be ignored silently. `'stateful'`, the default, matches what the session-based protocols
 *   do and is left alone.
 * - `session` (the pre-1.0 `@FrontMcp({ session })` option, replaced by `transport`): nothing reads
 *   it either. `session.sessionMode` is checked like `transport.sessionMode`, and
 *   `session.platformDetection` belongs in `transport.platformDetection`.
 *
 * Both stay accepted through 1.x (no behavior change) and are removed in the next major.
 */
export function warnIfSessionModeIgnored(options: {
  logger: { warn(message: string): void };
  transport?: { sessionMode?: unknown; protocol?: unknown };
  /** The deprecated top-level `session` option, accepted only to warn about it */
  session?: { sessionMode?: unknown; platformDetection?: unknown };
}): void {
  const { logger, transport, session } = options;

  const mode = transport?.sessionMode;
  if (transport && mode !== undefined && mode !== 'stateful' && !warned.has(transport)) {
    warned.add(transport);
    logger.warn(
      `transport.sessionMode (${describeMode(mode)}) ${REMOVAL}: sessions follow \`transport.protocol\`. ` +
        protocolAdvice(transport.protocol, 'sessionMode'),
    );
  }

  if (!session || warned.has(session)) return;
  const legacyMode = session.sessionMode;
  const ignored: string[] = [];
  if (legacyMode !== undefined && legacyMode !== 'stateful') {
    ignored.push(
      `session.sessionMode (${describeMode(legacyMode)}) ${REMOVAL}, with the rest of \`session\`: ` +
        'sessions follow `transport.protocol`, and provider tokens always stay server-side ' +
        `(\`auth.tokenStorage\`), never in the JWT. ${protocolAdvice(transport?.protocol, 'session')}`,
    );
  }
  if (session.platformDetection !== undefined) {
    ignored.push(
      `session.platformDetection ${REMOVAL}, with the rest of \`session\`: move it to \`transport.platformDetection\`.`,
    );
  }
  if (ignored.length === 0) return;
  warned.add(session);
  for (const message of ignored) logger.warn(message);
}
