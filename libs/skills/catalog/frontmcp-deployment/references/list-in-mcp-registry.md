---
name: list-in-mcp-registry
description: List a FrontMCP server in the MCP Registry - @FrontMcp({ registry }) serves the domain proof, the SEP-2127 server card and the AI Catalog, and frontmcp registry keygen, publish and status manage the listing
---

# Listing a Server in the MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) lists servers by a reverse-DNS name
(`com.acme/weather`). To publish under a domain's namespace you prove you control the domain, and
clients discover a listed server through its server card. `@FrontMcp({ registry })` serves both, and
`frontmcp registry` publishes the listing by speaking the Registry's API itself (no `mcp-publisher`
binary).

## When to Use This Skill

### Must Use

- Publishing a remote FrontMCP server, or its npm package, to the MCP Registry
- Serving `/.well-known/mcp-registry-auth` for `frontmcp registry publish --auth http`
- Publishing from CI, with the private key as a secret or with GitHub OIDC for `io.github.*` names

### Recommended

- Making a deployed server discoverable through its SEP-2127 server card and an AI Catalog
- Deprecating or deleting a published version

### Skip When

- You ship an installable archive for Claude Desktop: use `build-for-mcpb`
- You connect a client to your own server directly: use `mcp-client-integration`

## What the server serves

| Endpoint                             | Served when                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `GET /.well-known/mcp-registry-auth` | `registry` is set and a public key is configured      |
| `GET <entryPath>/server-card`        | `registry.name` is set and `serverCard` isn't `false` |
| `GET /.well-known/ai-catalog.json`   | the card is served and `aiCatalog` isn't `false`      |

- The domain proof is `text/plain`, `v=MCPv1; k=ed25519; p=<base64 key>`, always at the root of the
  host whatever `http.entryPath` is (the Registry fetches nothing else). Without a valid key it
  answers 404.
- The server card (`application/mcp-server-card+json`) names `registry.name` and `description`,
  `info.version`, `info.title`, `info.websiteUrl`, the `https` entries of `info.icons`,
  `registry.repository`, and one `streamable-http` remote: the server's endpoint with the protocol
  revisions FrontMCP serves. It is sent with `Access-Control-Allow-Origin: *` and an `ETag`
  (`If-None-Match` gets a 304), and answers its `OPTIONS` preflight with the same public CORS (204),
  even when `http.cors` restricts every other endpoint's origin. It is `Cache-Control: public, max-age=3600` when `FRONTMCP_PUBLIC_URL` is set,
  else `no-store`: without a pinned URL the body names the request's own origin, which a shared
  cache must not reuse.
- The AI Catalog (`application/ai-catalog+json`) lists the card as `urn:air:<domain>:mcp:<name>`:
  `com.acme/weather` is `urn:air:acme.com:mcp:weather`.
- `<entryPath>/server-card` is reserved: an `http.routes` entry there fails at startup.

## Configure

```typescript
@FrontMcp({
  info: { name: 'weather', title: 'Weather', version: '1.2.0', websiteUrl: 'https://acme.com/weather' },
  apps: [WeatherApp],
  http: { entryPath: '/mcp' },
  registry: {
    name: 'com.acme/weather', // <namespace>/<name>, 3-200 characters
    description: 'Forecasts and alerts for any city', // 1-100 characters, required with name
    repository: { url: 'https://github.com/acme/weather-mcp', source: 'github' },
    // publicKey: '<base64 Ed25519 key>', // else read from MCP_REGISTRY_PUBLIC_KEY
  },
})
export default class WeatherServer {}
```

| Field          | Default                   | Notes                                                                |
| -------------- | ------------------------- | -------------------------------------------------------------------- |
| `name`         | —                         | Enables the card and the catalog                                     |
| `description`  | —                         | Required when `name` is set                                          |
| `repository`   | —                         | `{ url, source: 'github' \| 'gitlab', subfolder? }`                  |
| `publicKey`    | —                         | Base64 Ed25519 public key, or a whole `v=MCPv1; k=...; p=...` record |
| `publicKeyEnv` | `MCP_REGISTRY_PUBLIC_KEY` | Read on each request when `publicKey` isn't set                      |
| `serverCard`   | `true` with `name`        |                                                                      |
| `aiCatalog`    | `true` with the card      |                                                                      |

An invalid `name`, `description` or `publicKey` fails at startup. An invalid key in the environment
is logged once and the proof answers 404.

## Create the key

```bash
frontmcp registry keygen                              # ~/.frontmcp/keys/mcp-registry.key
frontmcp registry keygen --out ./.keys/registry.key   # another path; --force replaces an existing key
```

keygen writes the Ed25519 private key as the 64-character hex seed (the format
`mcp-publisher login http --private-key` takes, so one key works with both tools), with mode `0600`,
and never prints it. It prints the public key, the `MCP_REGISTRY_PUBLIC_KEY=<key>` line and the DNS
TXT value `v=MCPv1; k=ed25519; p=<key>`. Keep the private key out of the repository: anyone holding
it can publish to your namespace. Replacing it invalidates the proof published for the old one.

## Deploy the domain proof

1. Put the Ed25519 public key (`frontmcp registry keygen` prints it) in `MCP_REGISTRY_PUBLIC_KEY`
   where the server runs (Cloudflare `[vars]` or a secret, Vercel or Lambda environment variables),
   or in `registry.publicKey`. It is the public key, never the private one.
2. Set `FRONTMCP_PUBLIC_URL=https://<your domain>` so the card and the catalog name the public
   `https` URL rather than the address a proxy forwards to, and so the card may be cached.
3. Deploy, then check the proof with the checklist below.

The host that serves the proof is the namespace:

| `--auth`             | Proof                                                   | Grants                                                                        |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `http` (the default) | `https://<domain>/.well-known/mcp-registry-auth`        | That exact host: `acme.com` → `com.acme/*`, `mcp.acme.com` → `com.acme.mcp/*` |
| `dns`                | A TXT record with the same value at the domain apex     | The apex and its subdomains: `com.acme/*` and `com.acme.*/*`                  |
| `github-oidc`        | The GitHub Actions ID token (no key, no proof to serve) | `io.github.<repository owner>/*` only                                         |

The Registry fetches the HTTP proof on port 443, does not follow redirects, needs a 200 and reads at
most 4096 bytes. `--domain` defaults to the name's namespace reversed (`com.acme.mcp/weather` logs in
as `mcp.acme.com`), and `github.io` domains can only use GitHub OIDC.

## Publish

`frontmcp registry publish` builds `server.json` from the same fields as the card, checks it with the
Registry's rules (name format, a 1-100 character description, a specific version, `https` URLs, no
localhost remotes, no unknown fields) and with `POST /v0.1/validate`, fetches the proof the way the
Registry does and says exactly what is wrong with it, then logs in and publishes. Where the server
runs comes from `frontmcp.config`:

```ts
export default defineConfig({
  name: 'weather',
  deployments: [{ target: 'node' }],
  registry: {
    url: 'https://acme.com/mcp', // remotes[0] (streamable-http); --url overrides it
    packages: ['npm'], // list package.json's name and version as an npm package (stdio)
    registryUrl: 'https://staging.registry.modelcontextprotocol.io', // optional, HTTPS; --registry overrides it
  },
});
```

- `description`, `version` and `repository` fall back to `package.json`. Non-`https` icons are left
  out with a warning.
- For an npm package, the Registry reads the published version's `package.json` and requires
  `"mcpName": "<server name>"` in it; `publish` checks the local one first and says what to add.
- Each `name@version` publishes once, even after it is deleted: bump `info.version` for every release.

Preview without logging in. `--dry-run` prints `server.json` alone on stdout and every diagnostic on
stderr, so the output can be reviewed, edited, and published as is with `--file`:

```bash
frontmcp registry publish --dry-run > server.json
frontmcp registry publish --file server.json
```

From a laptop, `frontmcp registry publish` reads the private key (hex seed or PEM) from `--key-file`,
else `MCP_REGISTRY_PRIVATE_KEY`, else keygen's `~/.frontmcp/keys/mcp-registry.key`. It prints
`name@version`, `isLatest` and the listing URL (`<registry>/v0.1/servers?search=<name>`); neither the
key nor the 5-minute login token is printed.

From GitHub Actions, store the key file's content as a secret:

```yaml
jobs:
  registry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx frontmcp registry publish
        env:
          MCP_REGISTRY_PRIVATE_KEY: ${{ secrets.MCP_REGISTRY_PRIVATE_KEY }}
```

For an `io.github.<owner>/<server>` name, give the job `permissions: { id-token: write, contents: read }`
and run `npx frontmcp registry publish --auth github-oidc` instead: no key is needed.

## Deprecate or delete

```bash
frontmcp registry status deprecated --server-version 1.2.0 --message "Use 2.x"
frontmcp registry status deleted --server-version 1.0.0
frontmcp registry status active --server-version 1.2.0
frontmcp registry status deprecated --all-versions --message "Moved to com.acme/forecast"
```

Pass exactly one of `--server-version <version>` and `--all-versions` (`--version` prints the CLI's
own version). `--message` (at most 500 characters) goes with `deprecated` or `deleted`. `status`
takes the same `--auth`, `--domain` and `--key-file` options, and `--name` outside the project.

## Limits

- The card describes the server's own endpoint. With `splitByApp`, or when every app is
  `standalone`, there is none: the domain proof is still served, the card and the catalog aren't.
- The card never carries secrets; it holds only the fields above.

## Verification Checklist

- [ ] `curl -i https://acme.com/.well-known/mcp-registry-auth` answers 200 with no redirect and the record
- [ ] `curl -i https://acme.com/mcp/server-card` names the public `https` endpoint in `remotes[0].url`
- [ ] `curl https://acme.com/.well-known/ai-catalog.json` lists `urn:air:acme.com:mcp:weather`
- [ ] `frontmcp registry publish --dry-run` passes both validations with the version you mean to publish
- [ ] After publishing, `<registry>/v0.1/servers?search=<name>` lists the version

## Troubleshooting

| Problem                                                          | Cause                                                        | Solution                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| The proof answers 404 (`The HTTP proof is not ready: ... 404`)   | No `registry` option, no key, or an invalid key in the env   | Set `registry` and `MCP_REGISTRY_PUBLIC_KEY`; check the startup log          |
| `... redirects (301) to ...`                                     | A proxy or the platform redirects the well-known path        | Serve it on the exact host the namespace names                               |
| `... publishes the key X, but the private key's public key is Y` | The server and the private key disagree                      | Update `MCP_REGISTRY_PUBLIC_KEY`, or log in with the matching key            |
| A 403, or `An HTTP proof on <domain> grants ...`                 | The name's namespace isn't the domain the proof is served on | Use `com.acme/...` for `acme.com`, pass `--domain`, or use `--auth dns`      |
| `cannot publish duplicate version`                               | That `name@version` was published (maybe deleted) before     | Bump the version                                                             |
| `missing required 'mcpName' field`                               | The published npm package lacks `mcpName`                    | Add `"mcpName": "<server name>"` to `package.json` and publish a new version |
| `remote URL ... is already used by server ...`                   | Another server name lists that URL                           | Publish under that name, or use a different URL                              |
| `Set @FrontMcp({ registry: { name: ... } })`                     | No `registry.name` in the entry                              | Add the `registry` option                                                    |
| `--auth github-oidc works only in GitHub Actions`                | No `ACTIONS_ID_TOKEN_REQUEST_*` variables                    | Run in GitHub Actions with `permissions: id-token: write`                    |
| The card names `http://` or an inner host                        | No `FRONTMCP_PUBLIC_URL` behind a TLS-terminating proxy      | Set `FRONTMCP_PUBLIC_URL`, or `FRONTMCP_TRUST_PROXY` for a trusted proxy     |
| The card answers 404                                             | No `registry.name`, `serverCard: false`, or `splitByApp`     | Set `name`; the card describes the server-level endpoint only                |

## Reference

- MCP Registry: https://registry.modelcontextprotocol.io (staging: https://staging.registry.modelcontextprotocol.io)
- Docs: https://frontmcp.dev/reference/cli
- Related skills: `deploy-to-cloudflare`, `deploy-to-vercel`, `deploy-to-node`, `build-for-mcpb`, `frontmcp-config` (`configure-http`)
