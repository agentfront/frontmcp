---
name: list-in-mcp-registry
description: List a deployed FrontMCP server in the MCP Registry - serve the domain proof, the SEP-2127 server card and the AI Catalog with @FrontMcp({ registry })
---

# Listing a Server in the MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) lists servers by a reverse-DNS name
(`com.acme/weather`). To publish under a domain's namespace you prove you control the domain, and
clients discover a listed server through its server card. `@FrontMcp({ registry })` serves both.

## When to Use This Skill

### Must Use

- Publishing a remote FrontMCP server to the MCP Registry under your own domain
- Serving `/.well-known/mcp-registry-auth` for `frontmcp registry publish --auth http`

### Recommended

- Making a deployed server discoverable through its SEP-2127 server card and an AI Catalog

### Skip When

- The server only runs locally over stdio (publish the npm package instead; the Registry needs an
  `"mcpName"` in its `package.json`)
- You publish as `io.github.<owner>/...` with GitHub OIDC and don't need a server card: no domain
  proof is needed

## What the server serves

| Endpoint                             | Served when                                                       |
| ------------------------------------ | ----------------------------------------------------------------- |
| `GET /.well-known/mcp-registry-auth` | `registry` is set and a public key is configured                  |
| `GET <entryPath>/server-card`        | `registry.name` is set and `serverCard` isn't `false`             |
| `GET /.well-known/ai-catalog.json`   | the card is served and `aiCatalog` isn't `false`                  |

- The domain proof is `text/plain`, `v=MCPv1; k=ed25519; p=<base64 key>`, always at the root of the
  host whatever `http.entryPath` is (the Registry fetches nothing else). Without a valid key it
  answers 404.
- The server card (`application/mcp-server-card+json`) names `registry.name` and `description`,
  `info.version`, `info.title`, `info.websiteUrl`, the `https` entries of `info.icons`,
  `registry.repository`, and one `streamable-http` remote: the server's endpoint with the protocol
  revisions FrontMCP serves. It is sent with `Access-Control-Allow-Origin: *`,
  `Cache-Control: public, max-age=3600` and an `ETag` (`If-None-Match` gets a 304).
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

| Field          | Default                   | Notes                                                                       |
| -------------- | ------------------------- | --------------------------------------------------------------------------- |
| `name`         | —                         | Enables the card and the catalog                                            |
| `description`  | —                         | Required when `name` is set                                                 |
| `repository`   | —                         | `{ url, source: 'github' \| 'gitlab', subfolder? }`                         |
| `publicKey`    | —                         | Base64 Ed25519 public key, or a whole `v=MCPv1; k=...; p=...` record        |
| `publicKeyEnv` | `MCP_REGISTRY_PUBLIC_KEY` | Read on each request when `publicKey` isn't set                             |
| `serverCard`   | `true` with `name`        |                                                                             |
| `aiCatalog`    | `true` with the card      |                                                                             |

An invalid `name`, `description` or `publicKey` fails at startup. An invalid key in the environment
is logged once and the proof answers 404.

## Publish

1. `frontmcp registry keygen` creates the Ed25519 key pair: the private key stays in a 0600 file
   (`~/.frontmcp/keys/mcp-registry.key`), and it prints the `MCP_REGISTRY_PUBLIC_KEY=<base64>` line.
2. Set `MCP_REGISTRY_PUBLIC_KEY` where the server runs (Cloudflare `[vars]` or a secret, Vercel or
   Lambda environment variables) and deploy. It is a public key, never the private one.
3. Set `FRONTMCP_PUBLIC_URL=https://<your domain>` so the card and the catalog name the public
   `https` URL rather than the address a proxy forwards to.
4. `frontmcp registry publish` builds `server.json`, checks the domain proof, logs in to the
   Registry with the private key and publishes.

The namespace follows the exact domain the proof is served on: `acme.com` grants `com.acme/*`, and
`mcp.acme.com` grants `com.acme.mcp/*` (no subdomains). The Registry fetches
`https://<domain>/.well-known/mcp-registry-auth` on port 443 and does not follow redirects.

## Limits

- The card describes the server's own endpoint. With `splitByApp`, or when every app is
  `standalone`, there is none: the domain proof is still served, the card and the catalog aren't.
- The card never carries secrets; it holds only the fields above.

## Verification Checklist

- [ ] `curl -i https://acme.com/.well-known/mcp-registry-auth` answers 200 with no redirect and the record
- [ ] `curl -i https://acme.com/mcp/server-card` names the public `https` endpoint in `remotes[0].url`
- [ ] `curl https://acme.com/.well-known/ai-catalog.json` lists `urn:air:acme.com:mcp:weather`

## Troubleshooting

| Problem                                  | Cause                                                         | Solution                                                               |
| ---------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The proof answers 404                    | No `registry` option, no key, or an invalid key in the env    | Set `registry` and `MCP_REGISTRY_PUBLIC_KEY`; check the startup log    |
| Publishing is refused with a 403         | The name's namespace isn't the domain the proof is served on  | Use `com.acme/...` for `acme.com`, `com.acme.mcp/...` for `mcp.acme.com` |
| The card names `http://` or an inner host | No `FRONTMCP_PUBLIC_URL` behind a TLS-terminating proxy       | Set `FRONTMCP_PUBLIC_URL`, or `FRONTMCP_TRUST_PROXY` for a trusted proxy |
| The card answers 404                     | No `registry.name`, `serverCard: false`, or `splitByApp`      | Set `name`; the card describes the server-level endpoint only          |

## Reference

- MCP Registry: https://registry.modelcontextprotocol.io
- Related skills: `deploy-to-cloudflare`, `deploy-to-vercel`, `deploy-to-node`, `frontmcp-config` (`configure-http`)
