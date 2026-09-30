import type { FrontMcpConfigParsed } from './frontmcp-config.schema';
import type { ServerDefaults } from './frontmcp-config.types';

/**
 * Translates `server.csp` / `server.headers` from `frontmcp.config.*` into the
 * `FRONTMCP_*` environment variables the SDK reads at startup
 * (`readSecurityHeadersFromEnv` / `readCspFromEnv`). `false` becomes `off`.
 */
export function securityHeadersEnv(server: ServerDefaults | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const { csp, headers } = server ?? {};

  if (csp) {
    if (csp.enabled !== undefined) env['FRONTMCP_CSP_ENABLED'] = String(csp.enabled);
    if (csp.directives) {
      const rendered = Object.entries(csp.directives)
        .map(([name, value]) => `${name} ${Array.isArray(value) ? value.join(' ') : value}`.trim())
        .join('; ');
      if (rendered) env['FRONTMCP_CSP_DIRECTIVES'] = rendered;
    }
    if (csp.reportUri !== undefined) env['FRONTMCP_CSP_REPORT_URI'] = csp.reportUri;
    if (csp.reportOnly !== undefined) env['FRONTMCP_CSP_REPORT_ONLY'] = String(csp.reportOnly);
  }

  if (headers) {
    const encode = (value: string | false | undefined): string | undefined =>
      value === false ? 'off' : value === undefined ? undefined : value;
    const hsts = encode(headers.hsts);
    const contentTypeOptions = encode(headers.contentTypeOptions);
    const frameOptions = encode(headers.frameOptions);
    if (hsts !== undefined) env['FRONTMCP_HSTS'] = hsts;
    if (contentTypeOptions !== undefined) env['FRONTMCP_CONTENT_TYPE_OPTIONS'] = contentTypeOptions;
    if (frameOptions !== undefined) env['FRONTMCP_FRAME_OPTIONS'] = frameOptions;
    if (headers.custom && Object.keys(headers.custom).length > 0) {
      env['FRONTMCP_HEADERS_CUSTOM'] = JSON.stringify(headers.custom);
    }
  }

  return env;
}

/** Setup-template lines that set each variable only when the platform has not already defined it. */
export function securityHeadersEnvSetupLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `if (process.env.${key} === undefined) process.env.${key} = ${JSON.stringify(value)};\n`)
    .join('');
}

/** First deployment that declares a non-empty `server` block. */
export function pickServerDefaults(config: FrontMcpConfigParsed | undefined): ServerDefaults | undefined {
  for (const deployment of config?.deployments ?? []) {
    const server = (deployment as { server?: ServerDefaults }).server;
    if (server && Object.keys(server).length > 0) return server;
  }
  return undefined;
}
