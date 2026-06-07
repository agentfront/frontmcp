// common/types/options/http/schema.ts
// Zod schema for HTTP configuration. Uses lazy-zod so the schema tree is
// not constructed at module load when nothing parses it.

import { z } from '@frontmcp/lazy-zod';

import type { HttpMethod, ServerRequestHandler } from '../../../interfaces';
import type { RawZodShape } from '../../common.types';
import type { CorsOptions, HttpOptionsInterface } from './interfaces';

type CorsOriginCallback = Extract<CorsOptions['origin'], Function>;

/** HTTP methods accepted by custom routes — mirrors the `HttpMethod` union. */
const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
] as const satisfies readonly HttpMethod[];

/**
 * Custom HTTP route schema (issue #465). `handler` is a function, which Zod
 * cannot introspect, so we validate it with `z.custom` — the same pattern used
 * for `hostFactory` (`z.any()`) and the CORS origin callback. Type safety for
 * the handler signature is enforced via the `HttpRouteConfig` TS interface.
 */
const httpRouteSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1),
  handler: z.custom<ServerRequestHandler>((v) => typeof v === 'function', {
    message: 'route.handler must be a function (req, res, next) => void | Promise<void>',
  }),
  auth: z.boolean().optional(),
});

/**
 * Body-parser-compatible size limit. Accepts:
 *   - a non-negative integer number of bytes, or
 *   - a unit-suffixed string matching what the `bytes` library (used by
 *     body-parser) parses: `b`, `kb`, `mb`, `gb`, `tb`, `pb` (case-insensitive),
 *     with optional whitespace between the number and the unit and an optional
 *     decimal portion (e.g. `'500kb'`, `'1.5gb'`, `'10 MB'`).
 *
 * Tightened on PR #422 — the prior `z.union([z.number(), z.string()])` accepted
 * typos like `'4mbb'` or `'10xyz'` that body-parser then silently treated as
 * unbounded. Validating up-front turns those into clear configuration errors.
 */
const bodyParserLimitSchema = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?\s*(b|kb|mb|gb|tb|pb)$/i, {
      message: 'Body limit must be a byte count or unit-suffixed string (e.g. "4mb", "500kb", 1048576).',
    }),
]);

/**
 * CORS options Zod schema.
 * Origin accepts boolean, string, string array, or a callback function.
 */
const corsOptionsSchema = z.object({
  origin: z
    .union([
      z.boolean(),
      z.string(),
      z.array(z.string()),
      z.custom<CorsOriginCallback>((val) => typeof val === 'function'),
    ])
    .optional(),
  credentials: z.boolean().optional(),
  maxAge: z.number().optional(),
});

/**
 * HTTP options Zod schema.
 */
export const httpOptionsSchema = z.object({
  port: z
    .number()
    .optional()
    .default(Number(process.env['PORT']) || 3000),
  // `FRONTMCP_HTTP_ENTRY_PATH` lets `frontmcp dev` propagate the configured
  // `transport.http.path` to the spawned server so the MCP endpoint is mounted
  // where the generated client URL points (#446) — mirrors how `port` reads
  // `PORT` above. The function default reads the env at parse time. An explicit
  // `entryPath` in `@FrontMcp({ http })` still wins (the default applies only
  // when the field is omitted).
  entryPath: z.string().default(() => process.env['FRONTMCP_HTTP_ENTRY_PATH'] ?? ''),
  // Using z.any() because hostFactory accepts FrontMcpServer | ((config) => FrontMcpServer)
  // which Zod cannot validate at runtime - type safety is enforced via TypeScript interface
  hostFactory: z.any().optional(),
  /**
   * Unix socket path for local-only server mode.
   * When set, the server listens on a Unix socket instead of a TCP port.
   * Express natively supports `app.listen('/path/to/file.sock')`.
   */
  socketPath: z.string().optional(),
  /**
   * CORS configuration.
   * - undefined (default): permissive CORS (all origins, no credentials)
   * - false: CORS disabled
   * - CorsOptions object: custom CORS config
   */
  cors: z.union([z.literal(false), corsOptionsSchema]).optional(),
  /**
   * Security configuration for transport hardening.
   * Opt-in — defaults remain backwards-compatible.
   */
  security: z
    .object({
      strict: z.boolean().optional(),
      bindAddress: z.union([z.literal('loopback'), z.literal('all'), z.string()]).optional(),
      dnsRebindingProtection: z
        .object({
          enabled: z.boolean().optional(),
          allowedHosts: z.array(z.string()).optional(),
          allowedOrigins: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  /**
   * Maximum accepted body size for JSON-RPC POST requests. Number of bytes or
   * a body-parser-compatible string ('4mb', '500kb', etc.). Defaults to '4mb'.
   */
  bodyLimit: bodyParserLimitSchema.default('4mb'),
  /**
   * Maximum accepted body size for application/x-www-form-urlencoded requests.
   * Falls back to `bodyLimit` when omitted (handled at the adapter layer).
   */
  urlencodedLimit: bodyParserLimitSchema.optional(),
  /**
   * First-class custom HTTP routes (issue #465). Mounted on the same Express
   * app as the MCP endpoint; public by default, `auth: true` opts into the MCP
   * `session:verify` flow. Reserved-path collisions are rejected at startup.
   */
  routes: z.array(httpRouteSchema).optional(),
} satisfies RawZodShape<HttpOptionsInterface>);

/**
 * HTTP configuration type (with defaults applied).
 */
export type HttpOptions = z.infer<typeof httpOptionsSchema>;

/**
 * HTTP configuration input type (for user configuration).
 * Uses explicit interface for better IDE autocomplete.
 */
export type HttpOptionsInput = HttpOptionsInterface;
