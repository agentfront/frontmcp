/**
 * @file misconfiguration.ts
 * @description Shared classification of "the deployment is misconfigured" errors, so every
 * adapter (Node/Express, Vercel, Lambda, Worker) answers the same structured body.
 */

/**
 * Error codes that mean "the deployment is misconfigured", not "something went
 * wrong handling this request". They name a missing setting and nothing about
 * the request, the user, or any secret's value, so echoing the code is safe and
 * saves the operator a `wrangler tail` against live traffic (#546).
 */
export const MISCONFIGURATION_REMEDIES: Record<string, string> = {
  SESSION_SECRET_REQUIRED:
    'Set MCP_SESSION_SECRET in the deployment environment (e.g. `wrangler secret put MCP_SESSION_SECRET` on Cloudflare, or the platform environment settings on Node, Vercel and Lambda). ' +
    'Session IDs are encrypted with it, and production refuses the development machine-id fallback.',
  JWT_SECRET_INVALID:
    'JWT_SECRET is present but too weak: HS256 requires at least 32 bytes (RFC 7518). ' +
    'Replace it with `openssl rand -hex 32`.',
  JWT_SECRET_REQUIRED:
    'Set JWT_SECRET in the deployment environment (e.g. `wrangler secret put JWT_SECRET`). ' +
    'Tokens are signed with it; production refuses the random per-process fallback because tokens would ' +
    'not survive a restart or verify across instances.',
  // The startup checks: a server whose entries ask for protection nothing gives them does not start.
  UNENFORCED_METADATA:
    'An entry declares a field only a plugin enforces (approval, featureFlag, ...) and no installed plugin that ' +
    'enforces it reaches the entry, so the server refuses to start. Install the plugin or remove the field; ' +
    'the server log names the entries.',
  AUTH_CONFIGURATION_ERROR:
    'The auth or authorities configuration is invalid (for example, entries declare authorities and the server ' +
    'has no authorities option, or a rule checks nothing), so the server refuses to start. The server log names ' +
    'the entries.',
};

/**
 * Recognize an error that carries one of the codes above, however deeply it is
 * wrapped. The message is never echoed — only the fixed code and remedy are.
 */
export function findMisconfiguration(error: unknown): { code: string; remedy: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(MISCONFIGURATION_REMEDIES, code)) {
      return { code, remedy: MISCONFIGURATION_REMEDIES[code] };
    }
    // The config itself failed validation (the server's schema, not the request's).
    if (current.name === 'ZodError') return { code: 'CONFIG_INVALID', remedy: CONFIG_INVALID_REMEDY };
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

interface ConfigIssueLike {
  path?: ReadonlyArray<PropertyKey>;
  message?: string;
  /** The branches of a failed union (`invalid_union`), each with its own issues. */
  errors?: ReadonlyArray<ReadonlyArray<ConfigIssueLike>>;
}

/** A union's failure is reported through the branch closest to matching: the one with the fewest issues. */
function flattenConfigIssue(issue: ConfigIssueLike, parentPath: ReadonlyArray<PropertyKey>): ConfigIssueLike[] {
  const path = [...parentPath, ...(issue.path ?? [])];
  const branches = issue.errors?.filter((branch) => branch.length > 0) ?? [];
  if (branches.length === 0) return [{ path, message: issue.message }];
  const closestBranch = branches.reduce((closest, branch) => (branch.length < closest.length ? branch : closest));
  return closestBranch.flatMap((nested) => flattenConfigIssue(nested, path));
}

/**
 * The invalid fields of a configuration that failed validation, as `path: message` pairs (the
 * CONFIG_INVALID remedy points at the log for them), or `undefined` when no validation error is in
 * `error`'s cause chain. Zod messages name the expected shape, not the value.
 */
export function describeConfigIssues(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.name === 'ZodError') {
      const issues = ((current as { issues?: ConfigIssueLike[] }).issues ?? []).flatMap((issue) =>
        flattenConfigIssue(issue, []),
      );
      return issues
        .map(
          (issue) =>
            `${issue.path?.length ? issue.path.map(String).join('.') : '(root)'}: ${issue.message ?? 'invalid'}`,
        )
        .join('; ');
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const CONFIG_INVALID_REMEDY =
  'The FrontMCP configuration failed validation, so the server refuses to start. The server log names the ' +
  'invalid fields.';

/** The structured `server_misconfigured` response body for a recognized fault. */
export function misconfigurationBody(m: { code: string; remedy: string }): {
  error: 'server_misconfigured';
  code: string;
  message: string;
} {
  return { error: 'server_misconfigured', code: m.code, message: m.remedy };
}
