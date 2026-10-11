/**
 * FrontMCP Config — Zod Validation Schema
 *
 * Validates and normalizes `frontmcp.config` files.
 * The schema is also the source of truth for JSON Schema generation.
 */

// Lazy-by-default `z`. Same API as `zod`'s `z`, but compound schemas
// (`z.object`, `z.union`, `z.discriminatedUnion`, `z.intersection`,
// `z.record`, `z.tuple`) defer construction until first `.parse()`.
// This schema is parsed at CLI startup — using lazy-z keeps module load
// from materializing every nested config-shape eagerly.
//
// Imported directly from `@frontmcp/lazy-zod` (not the `@frontmcp/sdk`
// barrel) to keep this leaf module lightweight — pulling the full SDK
// barrel into Jest's transform chain trips on `jose`'s ESM-only build.
import { z } from '@frontmcp/lazy-zod';

// ============================================
// Server Defaults
// ============================================

export const corsConfigSchema = z
  .object({
    origins: z
      .array(z.string())
      .optional()
      .describe("Allowed origins (`['*']` = any origin). Omitted or empty = no CORS headers."),
    credentials: z.boolean().optional().describe('Allow credentials (cookies, authorization headers).'),
    maxAge: z.number().int().positive().optional().describe('Preflight cache max age in seconds.'),
  })
  .strict();

export const cspConfigSchema = z
  .object({
    enabled: z.boolean().optional().describe('Enable CSP headers.'),
    directives: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional()
      .describe("CSP directives (e.g. 'default-src': \"'self'\")."),
    reportUri: z.string().optional().describe('Report URI for CSP violations.'),
    reportOnly: z.boolean().optional().describe('Use Content-Security-Policy-Report-Only.'),
  })
  .strict();

export const cookiesConfigSchema = z
  .object({
    affinity: z.string().optional().describe('LB affinity cookie name (distributed target).'),
    domain: z.string().optional().describe('Cookie domain.'),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite policy.'),
  })
  .strict();

export const securityHeadersSchema = z
  .object({
    hsts: z
      .union([z.string(), z.literal(false)])
      .optional()
      .describe('Strict-Transport-Security. Set to false to disable.'),
    contentTypeOptions: z
      .union([z.string(), z.literal(false)])
      .optional()
      .describe('X-Content-Type-Options. Set to false to disable.'),
    frameOptions: z
      .union([z.string(), z.literal(false)])
      .optional()
      .describe('X-Frame-Options. Set to false to disable.'),
    custom: z.record(z.string(), z.string()).optional().describe('Custom response headers.'),
  })
  .strict();

export const httpConfigSchema = z
  .object({
    port: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .optional()
      .describe('HTTP port (PORT default). Only for node/distributed targets.'),
    socketPath: z
      .string()
      .optional()
      .describe('Unix socket path (alternative to port). Only for node/distributed targets.'),
    entryPath: z
      .string()
      .optional()
      .describe("MCP entry path ('' or '/mcp'); wins over transport.http.path for this deployment."),
    cors: corsConfigSchema.optional().describe('CORS configuration.'),
  })
  .strict();

export const serverDefaultsSchema = z
  .object({
    http: httpConfigSchema.optional().describe('HTTP options, aligned with @FrontMcp({ http }).'),
    csp: cspConfigSchema.optional().describe('Content-Security-Policy headers.'),
    cookies: cookiesConfigSchema.optional().describe('Load-balancer affinity cookie (distributed target).'),
    headers: securityHeadersSchema.optional().describe('Security response headers.'),
  })
  .strict();

export const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const envVarNameSchema = z
  .string()
  .regex(ENV_VAR_NAME_PATTERN, 'Must be an environment variable name (letters, digits, _; not starting with a digit)');

// ============================================
// Build Options
// ============================================

export const esbuildOptionsSchema = z
  .object({
    external: z
      .array(z.string())
      .optional()
      .describe(
        'Packages esbuild leaves out of the bundle (not applied to self-contained bundles: SEA binaries, the mcpb server).',
      ),
    define: z.record(z.string(), z.string()).optional().describe('Global identifier replacements (esbuild define).'),
    target: z.string().optional().describe('esbuild target (default node22).'),
    minify: z.boolean().optional().describe('Minify the bundle.'),
  })
  .strict();

export const buildOptionsSchema = z
  .object({
    esbuild: esbuildOptionsSchema.optional().describe('esbuild options for every target that bundles with esbuild.'),
    dependencies: z
      .object({
        system: z.array(z.string()).optional().describe('System packages the installed app needs.'),
        nativeAddons: z
          .array(z.string())
          .optional()
          .describe('Native addon packages: kept external; an mcpb archive ships them in server/node_modules.'),
      })
      .strict()
      .optional()
      .describe('System packages and native addons the app needs.'),
    storage: z
      .object({
        type: z.enum(['sqlite', 'redis', 'none']),
        required: z.boolean().optional(),
      })
      .strict()
      .optional()
      .describe('Storage the installed app needs.'),
    network: z
      .object({
        defaultPort: z.number().int().optional(),
        supportsSocket: z.boolean().optional(),
      })
      .strict()
      .optional()
      .describe('Network defaults recorded in the build manifest.'),
  })
  .strict();

// ============================================
// Deployment Targets
// ============================================

export const haConfigSchema = z
  .object({
    heartbeatIntervalMs: z.number().int().positive().optional().describe('Heartbeat interval in milliseconds.'),
    heartbeatTtlMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Heartbeat TTL in milliseconds (should be 2-3x the interval).'),
    takeoverGracePeriodMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Grace period before claiming orphaned sessions.'),
    redisKeyPrefix: z.string().optional().describe('Redis key prefix for HA keys.'),
  })
  .strict();

export const cliTargetConfigSchema = z
  .object({
    description: z.string().optional().describe('CLI description shown in --help.'),
    outputDefault: z.enum(['text', 'json']).optional().describe('Default output format.'),
    authRequired: z
      .boolean()
      .optional()
      .describe('Generate login/logout/sessions/connect and refuse server calls until a credential is stored.'),
    excludeTools: z.array(z.string()).optional().describe('Tools left out of the generated subcommands.'),
    oauth: z
      .object({
        serverUrl: z.string().optional(),
        clientId: z.string().optional(),
        defaultScope: z.string().optional(),
        portRange: z.tuple([z.number(), z.number()]).optional(),
      })
      .strict()
      .optional()
      .describe('Defaults for the generated login command (needs authRequired).'),
  })
  .strict();

export const wranglerConfigSchema = z
  .object({
    name: z.string().optional().describe('Worker name.'),
    compatibilityDate: z
      .string()
      .optional()
      .describe(
        'Compatibility date. Defaults to 2024-11-11: nodejs_compat turns on nodejs_compat_v2 from 2024-09-23, and Vercel KV / Upstash need 2024-11-11.',
      ),
    compatibilityFlags: z
      .array(z.string())
      .optional()
      .describe('Extra Cloudflare compatibility flags. nodejs_compat is always emitted; list only additions.'),
  })
  .strict();

const deploymentBaseSchema = z.object({
  outDir: z.string().optional().describe('Output directory override (default dist/<target>).'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variable defaults the built artifact carries.'),
});

export const nodeDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('node'),
    server: serverDefaultsSchema.optional().describe('Server defaults (http, csp, cookies, headers).'),
  })
  .strict();

export const distributedDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('distributed'),
    server: serverDefaultsSchema.optional().describe('Server defaults (http, csp, cookies, headers).'),
    ha: haConfigSchema.optional().describe('High-availability settings.'),
  })
  .strict();

export const cliDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('cli'),
    js: z.boolean().optional().describe('Output a JS bundle instead of a native (SEA) binary.'),
    cli: cliTargetConfigSchema.optional().describe('Generated CLI options.'),
    sea: z
      .object({ enabled: z.boolean().optional() })
      .strict()
      .optional()
      .describe('Single executable application settings.'),
  })
  .strict();

export const vercelDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('vercel'),
    server: serverDefaultsSchema.optional().describe('Server defaults (cors, csp, headers).'),
  })
  .strict();

export const lambdaDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('lambda'),
    server: serverDefaultsSchema.optional().describe('Server defaults (cors, csp, headers).'),
  })
  .strict();

export const cloudflareDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('cloudflare'),
    server: serverDefaultsSchema.optional().describe('Server defaults (cors, csp, headers).'),
    wrangler: wranglerConfigSchema.optional().describe('wrangler.toml settings.'),
  })
  .strict();

export const browserDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('browser'),
  })
  .strict();

export const sdkDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('sdk'),
  })
  .strict();

// ============================================
// MCPB (MCP Bundles) target — produces a .mcpb ZIP archive
// per https://github.com/modelcontextprotocol/mcpb (manifest_version 0.3)
// ============================================

export const mcpbAuthorSchema = z
  .object({
    name: z.string().describe('Author name.'),
    email: z.string().email().optional().describe('Author email.'),
    url: z.string().url().optional().describe('Author URL.'),
  })
  .strict();

export const mcpbUserConfigEntrySchema = z
  .object({
    type: z
      .enum(['string', 'number', 'boolean', 'directory', 'file'])
      .describe('Input type shown in the install dialog.'),
    title: z.string().describe('Label shown in the install dialog.'),
    description: z.string().optional().describe('Help text shown in the install dialog.'),
    required: z.boolean().optional().describe('The user must provide a value.'),
    default: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe('Default value (omit for sensitive entries).'),
    multiple: z.boolean().optional().describe('Accept several values.'),
    sensitive: z.boolean().optional().describe('Mask the input and keep it out of plain-text storage.'),
    min: z.number().optional().describe('Minimum (number type).'),
    max: z.number().optional().describe('Maximum (number type).'),
    env: envVarNameSchema
      .optional()
      .describe('Env var the server receives the value in (default: the key in UPPER_SNAKE_CASE).'),
  })
  .strict();

export const mcpbCompatibilitySchema = z
  .object({
    claude_desktop: z.string().optional().describe('Semver range of Claude Desktop versions.'),
    platforms: z
      .array(z.enum(['darwin', 'win32', 'linux']))
      .optional()
      .describe(
        'Supported OSes (process.platform values). Defaults to the build OS when native addons are shipped, else all three.',
      ),
    runtimes: z
      .object({
        node: z.string().optional(),
        python: z.string().optional(),
      })
      .strict()
      .optional()
      .describe('Runtime version ranges.'),
  })
  .strict();

export const mcpbRepositorySchema = z.union([
  z.string(),
  z
    .object({
      type: z.string(),
      url: z.string(),
    })
    .strict(),
]);

export const mcpbDeploymentSchema = deploymentBaseSchema
  .extend({
    target: z.literal('mcpb'),
    displayName: z.string().optional().describe('Human-friendly display name shown in installer dialog.'),
    longDescription: z.string().optional().describe('Long markdown description shown in extension details.'),
    author: mcpbAuthorSchema
      .optional()
      .describe('Author object (name/email/url). Overrides parsed package.json.author.'),
    license: z.string().optional().describe('SPDX license identifier. Overrides package.json.license.'),
    homepage: z.string().url().optional().describe('Project homepage URL.'),
    repository: mcpbRepositorySchema.optional().describe('Source repository (string URL or {type, url}).'),
    documentation: z.string().url().optional().describe('Documentation URL.'),
    support: z.string().optional().describe('Support URL (issues/contact).'),
    icon: z.string().optional().describe('Path to icon (PNG) relative to project root.'),
    keywords: z.array(z.string()).optional().describe('Keywords for search.'),
    privacyPolicies: z
      .array(z.string())
      .optional()
      .describe('Privacy policy URLs for external services this bundle talks to.'),
    compatibility: mcpbCompatibilitySchema.optional().describe('Runtime/platform/client compatibility constraints.'),
    userConfig: z
      .record(z.string(), mcpbUserConfigEntrySchema)
      .optional()
      .describe('User-configurable inputs, each passed to the server as an env var (`mcp_config.env`).'),
    /** Single-executable-application binary integration. */
    sea: z
      .object({
        /** Build SEA binary for host platform and include via platform_overrides. */
        enabled: z.boolean().optional(),
        /** Directory of pre-built SEA binaries to merge (e.g., CI artifacts). */
        mergeFrom: z.string().optional(),
      })
      .strict()
      .optional()
      .describe('Single executable application binaries (not allowed with native addons).'),
    includeNodeModules: z.boolean().optional().meta({
      deprecated: true,
      description:
        'No effect: the server bundle inlines its runtime packages, so the archive never ships node_modules.',
    }),
    deterministic: z.boolean().optional().describe('Produce byte-identical archives across builds (default true).'),
  })
  .strict();

export const deploymentTargetSchema = z.discriminatedUnion('target', [
  nodeDeploymentSchema,
  distributedDeploymentSchema,
  cliDeploymentSchema,
  vercelDeploymentSchema,
  lambdaDeploymentSchema,
  cloudflareDeploymentSchema,
  browserDeploymentSchema,
  sdkDeploymentSchema,
  mcpbDeploymentSchema,
]);

// ============================================
// CLI extension (issue #409)
// ============================================
//
// `cli.commands` lets projects register custom `frontmcp <verb>` entries
// that show up in `frontmcp --help` alongside the built-ins and run with
// the project's full module graph (spawned via `tsx`).

/**
 * Built-in CLI verbs that a project verb may NOT shadow. The reserved set
 * also includes Commander's global flag tokens so a verb literally named
 * `--help` can't be defined.
 */
export const RESERVED_VERBS: ReadonlySet<string> = new Set([
  'dev',
  'build',
  'test',
  'init',
  'doctor',
  'inspector',
  'create',
  'start',
  'stop',
  'restart',
  'status',
  'list',
  'logs',
  'socket',
  'service',
  'install',
  'uninstall',
  'configure',
  'skills',
  'mcpb',
  'pm',
  'help',
  'version',
  '--help',
  '-h',
  '--version',
  '-V',
  '--list-commands',
]);

const projectCommandArgumentSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean().optional(),
    description: z.string().optional(),
    variadic: z.boolean().optional(),
  })
  .strict();

const projectCommandOptionSchema = z
  .object({
    flags: z.string().min(1),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict();

export const projectCommandEntrySchema = z
  .object({
    entry: z.string().min(1),
    description: z.string().optional(),
    arguments: z
      .array(projectCommandArgumentSchema)
      .optional()
      .superRefine((args, ctx) => {
        if (!args) return;
        // Commander allows variadic only on the final positional. Catch it
        // here instead of letting it surface as a cryptic runtime error.
        for (let i = 0; i < args.length - 1; i++) {
          if (args[i].variadic) {
            ctx.addIssue({
              code: 'custom',
              path: [i, 'variadic'],
              message: `Argument "${args[i].name}" is variadic but is not the last argument. Variadic positionals must be last.`,
            });
          }
        }
      }),
    options: z.array(projectCommandOptionSchema).optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export const cliExtensionConfigSchema = z
  .object({
    commands: z
      .record(z.string(), projectCommandEntrySchema)
      .optional()
      .superRefine((map, ctx) => {
        if (!map) return;
        for (const name of Object.keys(map)) {
          if (RESERVED_VERBS.has(name)) {
            ctx.addIssue({
              code: 'custom',
              path: [name],
              message:
                `Command "${name}" collides with a built-in frontmcp verb. ` +
                `Choose a project-specific name (e.g. "project:${name}").`,
            });
          }
          if (!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(name)) {
            ctx.addIssue({
              code: 'custom',
              path: [name],
              message: `"${name}" is not a valid verb name. Use letters, digits, ":", "_", "-".`,
            });
          }
        }
      }),
  })
  .strict();

// ============================================
// Transport defaults (issue #400)
// ============================================
//
// Per-protocol defaults consumed by `dev` / `inspector` / `pm start` / `pm
// socket` so server-startup flags don't have to be re-typed on every CLI
// invocation. Per-deployment `server.http.port` still wins where set.

export const transportHttpSchema = z
  .object({
    port: z.number().int().min(0).max(65535).optional().describe('HTTP port.'),
    path: z.string().optional().describe('MCP mount path.'),
    host: z.string().optional().describe('Bind host.'),
  })
  .strict();

export const transportStdioSchema = z
  .object({
    command: z.string().optional().describe('Command that starts the server over stdio.'),
    args: z.array(z.string()).optional().describe('Arguments for the stdio command.'),
  })
  .strict();

export const transportConfigSchema = z
  .object({
    default: z.enum(['http', 'sse', 'stdio']).optional().describe('Transport used by dev / inspector / pm start.'),
    http: transportHttpSchema.optional().describe('HTTP transport defaults.'),
    stdio: transportStdioSchema.optional().describe('stdio transport defaults.'),
  })
  .strict();

// ============================================
// Env overlays (issue #400)
// ============================================
//
// `shared` applies to every mode; mode-specific overlays (`dev`, `test`,
// `ship`) are merged on top. Effective env = `shared` ⊕ `<mode>` (later
// wins). Loaded by `dev`/`test`/`pm` in addition to `.env`/`.env.local`
// — file-based env still wins for parity with existing behavior.

export const envOverlaysSchema = z
  .object({
    shared: z.record(z.string(), z.string()).optional().describe('Env vars for every command.'),
    dev: z.record(z.string(), z.string()).optional().describe('Env vars for frontmcp dev / inspector.'),
    test: z.record(z.string(), z.string()).optional().describe('Env vars for frontmcp test.'),
    ship: z
      .record(z.string(), z.string())
      .optional()
      .describe('Env vars for built artifacts (pm start, eject-mcp-config).'),
  })
  .strict();

// ============================================
// MCP client connection snippets (issue #400)
// ============================================
//
// Per-client connection descriptors consumed by `frontmcp eject-mcp-config
// <client>` to emit ready-to-paste `.mcp.json` / `claude_desktop_config.json`
// / Cursor / Windsurf / VS Code snippets.

export const clientConnectionSchema = z
  .object({
    name: z.string().optional().describe('Server key in the client config (default: the config name).'),
    transport: z.enum(['http', 'sse', 'stdio']).describe('Transport the client uses.'),
    command: z.string().optional().describe('Spawn command (stdio). Default: npx -y <package name> --stdio.'),
    args: z.array(z.string()).optional().describe('Spawn arguments (stdio).'),
    env: z.record(z.string(), z.string()).optional().describe('Env vars for the spawned server.'),
    url: z.string().url().optional().describe('Server URL (http/sse). Derived from transport.http when omitted.'),
  })
  .strict();

// `z.record(z.enum([...]), …)` in Zod 4 treats every enum value as a
// REQUIRED key — so a `clients: { 'claude-code': {…} }` config (which is
// the shape the scaffold emits) fails validation with "expected object,
// received undefined" for the other four clients. The Verdaccio E2E
// surfaced this against the generated template. `partialRecord` is Zod 4's
// canonical fix: same enum-keyed schema but every key is optional, which
// matches the user-facing contract (clients are opt-in, not all-or-nothing).
export const clientsConfigSchema = z.partialRecord(
  z.enum(['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'vscode']),
  clientConnectionSchema,
);

// ============================================
// Test runner defaults (issue #400)
// ============================================
//
// `frontmcp test` defaults — overridden by CLI flags (`--timeout`,
// `--runInBand`, `--coverage`, `<patterns>`).

export const testConfigSchema = z
  .object({
    timeoutMs: z.number().int().positive().optional().describe('Test timeout in milliseconds.'),
    runInBand: z.boolean().optional().describe('Run tests serially.'),
    testMatch: z.array(z.string()).optional().describe('Test file patterns.'),
    coverage: z.boolean().optional().describe('Collect coverage.'),
    // Issue #519 — extra ESM-only packages Jest must transpile.
    esmPackages: z.array(z.string().min(1)).optional().describe('Extra ESM-only packages Jest must transpile.'),
  })
  .strict();

// ============================================
// Skills install / export defaults (issue #400)
// ============================================
//
// `frontmcp skills install` / `export` defaults — `install` is the list of
// catalog skill names a project depends on so `frontmcp skills install`
// with no arguments installs the curated set.

export const skillsCliConfigSchema = z
  .object({
    provider: z.enum(['claude', 'codex']).optional().describe('Default provider for frontmcp skills install.'),
    bundle: z
      .enum(['recommended', 'minimal', 'full', 'none'])
      .optional()
      .describe('Catalog bundle installed when no skill is named.'),
    install: z.array(z.string()).optional().describe('Catalog skills installed when no skill is named.'),
    exportTarget: z
      .enum(['cursor', 'windsurf', 'copilot'])
      .optional()
      .describe('Default target for frontmcp skills export.'),
  })
  .strict();

// ============================================
// Setup questionnaire
// ============================================
//
// `setup.steps` drive the install-time questionnaire (`frontmcp install` /
// `frontmcp configure`) and become MCPB `user_config` entries.

export const setupStepSchema = z
  .object({
    id: z.string().min(1).describe('Step identifier.'),
    prompt: z.string().describe('Question shown to the user.'),
    description: z.string().optional().describe('Help text.'),
    schema: z.unknown().optional().describe('Zod schema for the answer (config files written in JS/TS).'),
    jsonSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for the answer.'),
    env: envVarNameSchema
      .optional()
      .describe('Env var that receives the answer (default: the id in UPPER_SNAKE_CASE).'),
    sensitive: z.boolean().optional().describe('Mask the input.'),
    group: z.string().optional().describe('Visual grouping label.'),
    next: z
      .union([z.string(), z.record(z.string(), z.string())])
      .optional()
      .describe('Next step id, or a map from answer to step id.'),
    showWhen: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional()
      .describe('Show the step only when earlier answers match.'),
  })
  .strict();

export const setupConfigSchema = z
  .object({
    steps: z.array(setupStepSchema).describe('Questions, in order.'),
  })
  .strict();

// ============================================
// Top-Level Config
// ============================================

export const frontmcpConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema pointer for IDE autocomplete.'),
    name: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Must be alphanumeric with .-_ only')
      .describe('Server name (alphanumeric with .-_ only).'),
    version: z.string().optional().describe('Server version (semver). Defaults to package.json version.'),
    entry: z.string().optional().describe('Entry point file path.'),
    nodeVersion: z.string().optional().describe('Node.js version requirement (default >=22.0.0).'),
    deployments: z
      .array(deploymentTargetSchema)
      .min(1, 'At least one deployment target required')
      .describe('Build targets; each carries its own server and target settings.'),
    build: buildOptionsSchema
      .optional()
      .describe('Build and bundler options for every target that bundles with esbuild.'),
    setup: setupConfigSchema
      .optional()
      .describe(
        'Install-time questionnaire: frontmcp install / configure for node and cli, MCPB user_config for mcpb.',
      ),

    // Issue #409 — project-defined CLI verbs
    cli: cliExtensionConfigSchema.optional().describe('Project-defined frontmcp CLI commands.'),
    // Issue #400 — config drives every command, not just `build`
    transport: transportConfigSchema
      .optional()
      .describe('Transport defaults for dev / inspector / pm start / pm socket.'),
    env: envOverlaysSchema.optional().describe('Env overlays merged per command (in addition to .env / .env.local).'),
    clients: clientsConfigSchema
      .optional()
      .describe('MCP client snippets emitted by frontmcp eject-mcp-config <client>.'),
    test: testConfigSchema.optional().describe('frontmcp test defaults.'),
    skills: skillsCliConfigSchema.optional().describe('frontmcp skills install / export defaults.'),
  })
  .strict();

export type FrontMcpConfigInput = z.input<typeof frontmcpConfigSchema>;
export type FrontMcpConfigParsed = z.output<typeof frontmcpConfigSchema>;
