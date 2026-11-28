// What the Express host and the node:http host share (#948): their options, the body types they parse, the
// DNS-rebinding allow-list they derive, and how they listen and stop. Neither Express nor node:http objects are needed
// to load this module.
import type * as http from 'node:http';

import type { CorsOptions } from '../../common';
import type { SecurityHeadersOptions, SecurityOptions } from '../../common/types/options/http/interfaces';
import { createHostValidationMiddleware } from '../middleware/host-validation.middleware';
import {
  allowedHostsFromEnv,
  corsAllowedOrigins,
  deriveAllowedHosts,
  deriveAllowedOrigins,
  isLoopbackAddress,
  shouldEnforceDerivedHosts,
} from '../security/resolve-allowed-hosts';
import {
  assertSafeSocketDirectory,
  clearStaleSocket,
  enforceOwnerOnly,
  hasSocketFileMode,
  listenOwnerOnly,
} from '../security/unix-socket-guard';

export const SERVER_DRAIN_MS = 5_000;

/**
 * Default request body size for the Express host. Lifts body-parser's silent
 * 100KB default, which routinely rejected base64-encoded PDFs, DOCXes, and
 * large HTML inputs before they reached MCP tool handlers (issue #410).
 */
export const DEFAULT_EXPRESS_BODY_LIMIT = '4mb';

/**
 * Options for ExpressHostAdapter.
 */
export interface ExpressHostAdapterOptions {
  /**
   * CORS configuration.
   * The middleware is installed only when `origin` is set to something other than `false`, so
   * omitting `cors` — or passing `{}` / `{ origin: false }` — sends no CORS headers at all.
   */
  cors?: CorsOptions;

  /** Paths `cors` leaves alone because their flows send public CORS, preflight included (the server card). */
  publicCorsPaths?: string[];

  /**
   * Security options for transport hardening.
   * Includes bind address and DNS rebinding protection.
   */
  security?: SecurityOptions;

  /**
   * Response security headers. `nosniff` and `X-Frame-Options: DENY` are sent by
   * default; `FRONTMCP_*` env vars fill the rest. See {@link SecurityHeadersOptions}.
   */
  securityHeaders?: SecurityHeadersOptions;

  /**
   * Maximum body size for `express.json()`. Accepts a number of bytes or a
   * body-parser-compatible string ('4mb', '500kb', etc.). Defaults to '4mb'.
   */
  bodyLimit?: number | string;

  /**
   * Maximum body size for `express.urlencoded()`. Falls back to `bodyLimit`
   * when omitted.
   */
  urlencodedLimit?: number | string;

  /**
   * Supplemental listener metadata for the default DNS-rebinding allow-list.
   *
   * The address and port are NOT read from here — they come from the arguments
   * `start()` is actually called with, so the allow-list always describes the
   * listener this process opened. `issuer` names the public host a proxy
   * presents, which `start()` cannot know.
   */
  listen?: {
    issuer?: string;
  };
}

// Tolerant Content-Type matching (#473). Some OAuth clients (e.g. the MCP
// Inspector token refresh) send a hybrid header such as
// `application/json, application/x-www-form-urlencoded`. body-parser's
// default `type` matcher can't parse a comma-list, so NEITHER stock parser
// fired and `req.body` arrived empty — surfacing as an opaque
// "Invalid request body" at /oauth/token. We widen the matchers so:
//   - a header that CONTAINS `x-www-form-urlencoded` parses as urlencoded
//     (form wins; an actual form body would fail JSON.parse), and
//   - a header that CONTAINS `application/json` (and NOT the form type)
//     parses as JSON.
// Clean single-type headers keep their existing behavior.
const headerContains = (req: http.IncomingMessage, needle: string): boolean =>
  (req.headers['content-type'] ?? '').toLowerCase().includes(needle);
export const isUrlencoded = (req: http.IncomingMessage): boolean =>
  headerContains(req, 'application/x-www-form-urlencoded');
export const isJson = (req: http.IncomingMessage): boolean =>
  headerContains(req, 'application/json') && !isUrlencoded(req);

// The `application/json` bodies body-parser's `json()` reads as UTF-8: no charset, or `charset=utf-8`.
const UTF8_JSON_TYPE = /^application\/json(?:; ?charset=utf-8)?$/i;
export const isUtf8Json = (req: http.IncomingMessage): boolean =>
  UTF8_JSON_TYPE.test(req.headers['content-type'] ?? '');

export type HostValidation = ReturnType<typeof createHostValidationMiddleware>;

/**
 * DNS-rebinding protection (GHSA-mc9g-v2cp-vfff), ON by default since v1.7.2 (BC-035): the rules a host enforces
 * before `start()` (`initial`), and how it derives the rest once it knows its listener (`derive`).
 *
 * `allowedHosts` falls back to the names this process actually answers to — the loopback aliases with and without
 * the bound port, the bound NIC address, and the configured issuer host — whether or not `allowedOrigins` is set. On
 * a loopback bind `allowedOrigins` falls back to its own origins and the CORS list.
 *
 * Escape hatches, in precedence order: explicit `security.dnsRebindingProtection.allowedHosts`, the
 * `FRONTMCP_ALLOWED_HOSTS` env var, or `enabled: false` to turn it off.
 */
export function planHostValidation(options?: ExpressHostAdapterOptions):
  | {
      initial?: HostValidation;
      derive?: (portOrSocketPath: number | string, bindAddress?: string) => HostValidation | undefined;
    }
  | undefined {
  const protection = options?.security?.dnsRebindingProtection;
  if (protection?.enabled === false) return undefined;

  const allowedOrigins = protection?.allowedOrigins;
  const explicitHosts = protection?.allowedHosts ?? allowedHostsFromEnv();

  // An EXPLICIT allow-list applies to every deployment shape — this process
  // did not have to guess it.
  if (explicitHosts?.length) {
    return {
      initial: createHostValidationMiddleware({
        enabled: true,
        allowedHosts: explicitHosts,
        allowedOrigins,
      }),
    };
  }

  // Configured origins apply before `start()`, which a serverless handler never calls; the derived hosts join them.
  const initial =
    allowedOrigins !== undefined ? createHostValidationMiddleware({ enabled: true, allowedOrigins }) : undefined;
  // Otherwise the allow-list can only be DERIVED, and that is sound only
  // when this process owns the listener and therefore knows the address and
  // port clients reach it on. `start()` says so; a serverless handler
  // (`getHandler()`) never calls it, and its public hostname is unknowable
  // here — deriving one there would 403 every real request.
  const derive = (portOrSocketPath: number | string, bindAddress?: string): HostValidation | undefined => {
    // A Unix socket has no TCP host at all — the socket's filesystem
    // permissions are the boundary and clients send an arbitrary
    // placeholder Host. There is nothing to check and nothing to warn
    // about: acting on the routable-bind warning below would enforce a TCP
    // allow-list against that placeholder and reject every request.
    if (typeof portOrSocketPath === 'string') return undefined;

    // Describe the listener `start()` actually opened. Reading a predicted
    // address out of the options instead would leave a direct caller —
    // `new ExpressHostAdapter().start(3000, '127.0.0.1')` — with no port to
    // derive from, and therefore no protection on exactly the loopback
    // listener DNS rebinding targets.
    const derivation = {
      // `start()` binds `bindAddress ?? '127.0.0.1'`; mirror that exactly.
      bindAddress: bindAddress ?? '127.0.0.1',
      port: portOrSocketPath,
      issuer: options?.listen?.issuer,
    };
    if (!shouldEnforceDerivedHosts(derivation)) {
      // A routable bind with no public name to add: enforcing the derived
      // list would 403 every request arriving under the deployment's real
      // hostname. Warn instead — a server reachable from the network is not
      // the DNS-rebinding target anyway (that attack exists to reach
      // addresses the attacker otherwise cannot).
      console.warn(
        '[frontmcp] DNS-rebinding protection is not enforcing a Host allow-list: the server binds a routable ' +
          `address (${derivation.bindAddress}) and no allowed hosts are configured. ` +
          'Set security.dnsRebindingProtection.allowedHosts (or FRONTMCP_ALLOWED_HOSTS) to your public hostname(s).',
      );
      return undefined;
    }

    const allowedHosts = deriveAllowedHosts(derivation);
    // Nothing to check against means validating would reject everything, so
    // skip it rather than fail closed on a valid config.
    if (!allowedHosts.length) return undefined;

    // A page on another site reaches a loopback server under a loopback Host; only its Origin differs.
    const corsOrigins = corsAllowedOrigins(options?.cors);
    const derivedOrigins =
      isLoopbackAddress(derivation.bindAddress) && corsOrigins
        ? deriveAllowedOrigins({ port: derivation.port, issuer: derivation.issuer, extraOrigins: corsOrigins })
        : undefined;

    return createHostValidationMiddleware({
      enabled: true,
      allowedHosts,
      allowedOrigins: allowedOrigins ?? derivedOrigins,
    });
  };
  return { initial, derive };
}

/**
 * Listen on a TCP port (on `bindAddress`, `127.0.0.1` by default) or a Unix socket, and log the listener under
 * `label`. `onBound` runs inside the `listening` callback, so what it sets is in place before any request.
 */
export async function listenHttpServer(
  server: http.Server,
  portOrSocketPath: number | string,
  bindAddress: string | undefined,
  label: string,
  onBound: (portOrSocketPath: number | string, address?: string) => void,
  stop: () => Promise<void>,
): Promise<void> {
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 75_000;

  if (typeof portOrSocketPath === 'string') {
    const ownerOnly = hasSocketFileMode();
    if (ownerOnly) {
      await assertSafeSocketDirectory(portOrSocketPath);
      await clearStaleSocket(portOrSocketPath);
    }
    onBound(portOrSocketPath);
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      if (ownerOnly) listenOwnerOnly(server, portOrSocketPath, resolve);
      else server.listen(portOrSocketPath, resolve);
    });
    if (ownerOnly) {
      try {
        await enforceOwnerOnly(portOrSocketPath);
      } catch (error) {
        await stop();
        throw error;
      }
    }
    console.log(`MCP HTTP (${label}) on unix://${portOrSocketPath}`);
  } else {
    const host = bindAddress ?? '127.0.0.1';
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(portOrSocketPath, host, () => {
        // Derive AFTER binding: `port: 0` means "let the OS choose", and the
        // allow-list has to name the port clients actually dial. Deriving
        // from the literal 0 yields port-less loopback names and 403s every
        // request. The assignment is synchronous inside the `listening`
        // callback, so it lands before any request is dispatched.
        const bound = server.address();
        const boundPort = typeof bound === 'object' && bound ? bound.port : portOrSocketPath;
        const boundAddress = typeof bound === 'object' && bound ? bound.address : host;
        onBound(boundPort, boundAddress);
        console.log(`MCP HTTP (${label}) on ${host}:${boundPort}`);
        resolve();
      });
    });
  }
}

/**
 * Stop accepting connections, close idle keep-alive connections, and give requests in
 * flight `drainMs` to finish before closing what is left (SSE streams never finish) (#712).
 */
export async function closeHttpServer(server: http.Server, drainMs: number): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  const forceClose = setTimeout(() => server.closeAllConnections(), drainMs);
  try {
    await closed;
  } finally {
    clearTimeout(forceClose);
  }
}
