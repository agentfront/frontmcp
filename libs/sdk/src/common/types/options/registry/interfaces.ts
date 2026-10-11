// common/types/options/registry/interfaces.ts

/** The source repository the MCP Registry lists for the server. */
export interface McpRegistryRepositoryInterface {
  /** Repository URL, e.g. `https://github.com/acme/weather-mcp`. */
  url: string;
  source: 'github' | 'gitlab';
  /** Path of the server inside a monorepo. */
  subfolder?: string;
}

/**
 * MCP Registry support: serves `/.well-known/mcp-registry-auth` (the domain proof, at the root of
 * the host whatever `http.entryPath` is), `<entryPath>/server-card` (SEP-2127) and
 * `/.well-known/ai-catalog.json`. The card takes `title`, `version`, `websiteUrl` and `icons` from
 * `info`; set `FRONTMCP_PUBLIC_URL` so it names the public URL and may be cached. With `splitByApp`,
 * or when every app is `standalone`, only the domain proof is served.
 *
 * @example
 * ```typescript
 * registry: { name: 'com.acme/weather', description: 'Forecasts and alerts for any city' }
 * ```
 */
export interface McpRegistryOptionsInterface {
  /** Registry name, `<namespace>/<name>` in reverse-DNS form (`com.acme/weather`); serves the card and the catalog. */
  name?: string;

  /** 1-100 characters; required when `name` is set. */
  description?: string;

  repository?: McpRegistryRepositoryInterface;

  /** Base64 Ed25519 public key, or a whole `v=MCPv1; k=...; p=...` record served as given. */
  publicKey?: string;

  /**
   * Environment variable read on each request when `publicKey` isn't set; an invalid value is logged once and serves 404.
   *
   * @default 'MCP_REGISTRY_PUBLIC_KEY'
   */
  publicKeyEnv?: string;

  /** @default true when `name` is set */
  serverCard?: boolean;

  /** @default true when the server card is served */
  aiCatalog?: boolean;
}
