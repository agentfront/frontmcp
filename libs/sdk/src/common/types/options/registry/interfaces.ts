// common/types/options/registry/interfaces.ts

/**
 * The source repository the MCP Registry lists for the server.
 */
export interface McpRegistryRepositoryInterface {
  /** Repository URL, e.g. `https://github.com/acme/weather-mcp`. */
  url: string;
  /** Hosting service. */
  source: 'github' | 'gitlab';
  /** Path of the server inside a monorepo. */
  subfolder?: string;
}

/**
 * MCP Registry support for `@FrontMcp({ registry })`.
 *
 * The server can serve three documents:
 *
 * | Endpoint                              | Served when                                      |
 * |---------------------------------------|--------------------------------------------------|
 * | `GET /.well-known/mcp-registry-auth`  | a public key is set (`publicKey` or the env var) |
 * | `GET <entryPath>/server-card`         | `name` is set and `serverCard` isn't `false`     |
 * | `GET /.well-known/ai-catalog.json`    | the card is served and `aiCatalog` isn't `false` |
 *
 * - The domain proof (`v=MCPv1; k=ed25519; p=<key>`) lets `frontmcp registry publish --auth http`
 *   publish names under the domain's namespace (`acme.com` grants `com.acme/*`). It is always
 *   served at the root of the host, whatever `http.entryPath` is.
 * - The server card (SEP-2127) describes the server's own streamable-HTTP endpoint. Its `title`,
 *   `version`, `websiteUrl` and `icons` come from `info`; values the card's schema would reject (an
 *   `http:` URL, a title over 100 characters) are left out. Its URL comes from the request, or from
 *   `FRONTMCP_PUBLIC_URL` when set (recommended, so the card names the public `https` URL).
 * - The AI Catalog lists the card as `urn:air:<domain>:mcp:<name>`, the domain being the name's
 *   namespace reversed (`com.acme/weather` gives `urn:air:acme.com:mcp:weather`).
 *
 * With `splitByApp`, or when every app is `standalone`, there is no server-level endpoint: the
 * domain proof is still served, the server card and the AI Catalog aren't.
 *
 * @example
 * ```typescript
 * @FrontMcp({
 *   info: { name: 'weather', version: '1.2.0', websiteUrl: 'https://acme.com/weather' },
 *   apps: [WeatherApp],
 *   http: { entryPath: '/mcp' },
 *   registry: {
 *     name: 'com.acme/weather',
 *     description: 'Forecasts and alerts for any city',
 *     repository: { url: 'https://github.com/acme/weather-mcp', source: 'github' },
 *   },
 * })
 * ```
 */
export interface McpRegistryOptionsInterface {
  /**
   * Reverse-DNS server name as published to the MCP Registry, e.g. `com.acme/weather`
   * (3-200 characters, `<namespace>/<name>`). Setting it serves the server card and the AI Catalog.
   */
  name?: string;

  /**
   * One-line description, 1-100 characters. Required when `name` is set.
   */
  description?: string;

  /**
   * The source repository the Registry lists.
   */
  repository?: McpRegistryRepositoryInterface;

  /**
   * Public key for the domain proof: a base64 Ed25519 public key (as `frontmcp registry keygen`
   * prints it), or a whole `v=MCPv1; k=...; p=...` record, served as given.
   * Takes precedence over `publicKeyEnv`.
   */
  publicKey?: string;

  /**
   * Environment variable read, on each request, when `publicKey` isn't set. When it holds no
   * valid key the proof isn't served (404) and a warning is logged once.
   *
   * @default 'MCP_REGISTRY_PUBLIC_KEY'
   */
  publicKeyEnv?: string;

  /**
   * Serve the server card at `<entryPath>/server-card`.
   *
   * @default true when `name` is set
   */
  serverCard?: boolean;

  /**
   * Serve the AI Catalog at `/.well-known/ai-catalog.json`.
   *
   * @default true when the server card is served
   */
  aiCatalog?: boolean;
}
