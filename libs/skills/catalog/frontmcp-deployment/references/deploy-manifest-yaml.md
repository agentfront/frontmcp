---
name: deploy-manifest-yaml
description: The frontmcp.deploy.yaml v1 schema — declarative manifest the GitHub Action consumes on every push to build, sign, and hot-reload the Cloudflare Worker
---

# `frontmcp.deploy.yaml` — Schema Reference

This is the declarative manifest the GitHub Action ingests on every push. It is the source of truth for what your Cloudflare Worker serves. The schema is strict — unknown keys fail validation.

For the runtime that consumes the bundle, see `deploy-to-cloudflare-skills-only.md` in this same folder.
For the live docs version, see https://docs.agentfront.dev/frontmcp/deployment/deploy-manifest.

## Minimum Manifest

```yaml
$schema: https://schemas.agentfront.dev/frontmcp-deploy/v1.json
version: 1
name: acme-mcp

runtime:
  target: cloudflare-worker
  compatibilityDate: '2026-05-01'

server:
  info: { name: acme-mcp, version: 1.0.0 }

specs: ./openapi/
skills: { source: ./skills/ }

bindings:
  durableObjects:
    - { binding: SESSIONS, className: SessionDO }
  kvNamespaces:
    - { binding: REPLAY_NONCE, id: '${env:KV_REPLAY_NONCE_ID}' }

signing:
  algorithm: ed25519
  trustRoots:
    - { kid: prod-2026-05, publicKeySecret: TRUSTED_PUBKEY_PROD }
  replay: { windowSeconds: 300, nonceKv: REPLAY_NONCE }

auth: { provider: none }

secrets:
  - { name: TRUSTED_PUBKEY_PROD, required: true }
```

## Top-Level Keys

| Field            | Required | Notes                                                            |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `$schema`        | optional | URL pointer for editor autocomplete                              |
| `version`        | yes      | Literal `1` only in v1.3                                         |
| `name`           | yes      | Identifier: `[A-Za-z][A-Za-z0-9_-]*`                             |
| `runtime`        | yes      | `target` + `compatibilityDate` + optional `compatibilityFlags[]` |
| `server`         | yes      | `info` + optional `instructions` (≤ 16 KB)                       |
| `specs`          | yes      | Directory string OR `{ id, spec, baseUrl?, bindingName? }[]`     |
| `skills`         | optional | Defaults to `{ source: './skills/' }`                            |
| `tags`           | optional | `[{ name, description? }]` OpenAPI-shaped                        |
| `classification` | optional | Override rules over the auto-classifier                          |
| `bindings`       | yes      | CF DO / D1 / KV / R2 / vars (camelCase)                          |
| `signing`        | yes      | Algorithm + trust roots + replay-guard                           |
| `auth`           | yes      | `provider: none \| frontegg \| oauth \| apiKey`                  |
| `secrets`        | optional | Names-only; cross-validator enforces references                  |
| `environments`   | optional | Per-env overlay (deep-merge; bindings replace)                   |

## `runtime`

```yaml
runtime:
  target: cloudflare-worker
  compatibilityDate: '2026-05-01' # ISO-8601 YYYY-MM-DD
  compatibilityFlags: [nodejs_compat] # optional
```

## `server`

```yaml
server:
  info:
    name: acme-mcp
    version: 1.0.0
    title: ACME MCP # optional
  instructions: | # optional, max 16 KB
    Capabilities are organized as SKILLS...
```

## `specs`

```yaml
specs: ./openapi/ # directory; specId = filename stem
```

```yaml
specs:
  - ./openapi/acme.yaml
  - id: billing
    spec: ./openapi/billing.yaml
    baseUrl: https://billing.acme.com
    bindingName: billing # optional override for AgentScript namespace
```

## `skills`

```yaml
skills:
  source: ./skills/
  alwaysLoad: # forced-load skill ids (kebab-case)
    - auth-helpers
    - observability-helpers
  tags:
    include: [public, billing]
    exclude: [admin]
```

A skill can also self-opt-in via its SKILL.md frontmatter:

```yaml
---
name: auth-helpers
description: Helpers every agent needs.
alwaysLoad: true
hideFromDiscovery: true # load without showing in search
---
```

## `tags`

```yaml
tags:
  - { name: public, description: Always exposed }
  - { name: billing, description: Billing flows }
  - { name: admin, description: Admin only }
```

## `classification` Overrides

```yaml
classification:
  rules:
    - { match: 'POST **/reset-password', emits: parent }
    - { match: 'GET /metrics', expose: tool }
    - { match: 'DELETE /users/{id}', emits: none }
```

`match` = `METHOD path-glob`. Method may be `*`. `*` matches a single segment, `**` matches across `/`. First match wins.

## `bindings`

Mirror wrangler shapes (camelCased). Strict — unknown keys reject.

```yaml
bindings:
  durableObjects:
    - { binding: SESSIONS, className: SessionDO }
    - { binding: EVENTS, className: EventStoreDO }
    - { binding: BUNDLE, className: BundleDO }
  d1Databases:
    - { binding: AUDIT, databaseName: acme-audit, databaseId: '${env:D1_AUDIT_ID}' }
  kvNamespaces:
    - { binding: BUNDLE_CACHE, id: '${env:KV_BUNDLE_CACHE_ID}' }
    - { binding: REPLAY_NONCE, id: '${env:KV_REPLAY_NONCE_ID}' }
  r2Buckets:
    - { binding: SKILL_DATA, bucketName: acme-skill-data }
  vars:
    LOG_LEVEL: info
```

Binding names: SCREAMING_SNAKE_CASE.

## `signing`

```yaml
signing:
  algorithm: ed25519 # or rs256
  trustRoots:
    - kid: prod-2026-05
      publicKeySecret: TRUSTED_PUBKEY_PROD
  replay:
    windowSeconds: 300 # default 300; [10, 3600]
    nonceKv: REPLAY_NONCE # MUST match a kvNamespaces[].binding
```

Cross-validator enforces `replay.nonceKv` resolves to a KV binding name and every `publicKeySecret` appears in `secrets[]`.

## `auth` (Discriminated Union)

```yaml
auth: { provider: none }
```

```yaml
auth:
  provider: frontegg
  frontegg:
    tenantResolver: subdomain # or 'header' / 'jwt-claim'
    audience: acme-mcp
    issuerSecret: FRONTEGG_ISSUER_URL
```

```yaml
auth:
  provider: oauth
  oauth:
    issuer: https://issuer.example.com
    audience: acme-mcp
    credentialsSecret: M2M_CREDS # optional, M2M
```

```yaml
auth:
  provider: apiKey
  apiKey:
    header: X-API-Key
    allowlistSecret: ACME_API_KEYS
```

## `secrets`

```yaml
secrets:
  - { name: TRUSTED_PUBKEY_PROD, required: true, description: 'Signing trust root (PEM)' }
  - { name: FRONTEGG_ISSUER_URL, required: true }
  - { name: ACME_API_TOKEN, required: true, description: 'ACME API bearer' }
```

SCREAMING_SNAKE_CASE names only. Inline values are forbidden by the schema.

## `environments`

```yaml
environments:
  staging:
    specs:
      - id: acme
        spec: ./openapi/acme.yaml
        baseUrl: https://api.staging.acme.com
    skills: { tags: { include: [public, billing, ops] } }
    bindings: { vars: { LOG_LEVEL: debug } }
  production:
    skills: { tags: { include: [public, billing, ops], exclude: [admin, experimental] } }
    bindings: { vars: { LOG_LEVEL: info } }
```

Deep-merge for scalars + nested objects; `bindings` REPLACES (Wrangler non-inheritance semantics).

## Cross-Field Validation

After per-field schema parse, run `crossValidateManifest(parsed)`:

| Check                                                     | Error shape                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Secret referenced from auth/signing but not declared      | `Secret "<NAME>" referenced at <path> is not declared in secrets[]`               |
| `signing.replay.nonceKv` not in `bindings.kvNamespaces[]` | `signing.replay.nonceKv "<X>" does not match any bindings.kvNamespaces[].binding` |
| `skills.alwaysLoad[]` entry not kebab-case                | `skills.alwaysLoad entry "<X>" is not a valid kebab-case skill id`                |
| Tag filter references undeclared tag                      | `skills.tags references unknown tag "<X>" (not in tags[])`                        |

All errors aggregate in one report — not throw-on-first.

```ts
import * as YAML from 'yaml';

import { crossValidateManifest, deployManifestSchema } from '@frontmcp/adapters/skills';

const parsed = deployManifestSchema.parse(YAML.parse(raw));
const cross = crossValidateManifest(parsed);
if (!cross.ok) cross.errors.forEach((e) => console.error('manifest:', e));
```

## Auto-Classification Table (HTTP → MCP)

| Method      | Path                   | Matching GET? | Surface  | Notify on success            |
| ----------- | ---------------------- | ------------- | -------- | ---------------------------- |
| GET         | `/users/{id}`          | (self)        | both     | —                            |
| GET         | `/users`               | (self)        | resource | —                            |
| POST        | `/users`               | yes           | tool     | `list_changed` on self       |
| POST        | `/users/{id}`          | yes           | tool     | `updated` on self            |
| POST        | `/users/{id}/reset-pw` | no            | tool     | `updated` on parent          |
| POST        | any                    | no            | tool     | —                            |
| PUT / PATCH | any                    | yes           | tool     | `updated` on self            |
| PUT / PATCH | any                    | no            | tool     | `updated` on parent (if any) |
| DELETE      | singular               | —             | tool     | `list_changed` on parent     |
| DELETE      | collection             | yes           | tool     | `list_changed` on self       |

The notification fires once per call regardless of which skill made it. Two skills calling the same PUT → still one event.

## TypeScript Imports

```ts
import {
  applyClassificationOverrides,
  buildResourceChangeNotification,
  ClassificationRegistry,
  classifyOperations,
  crossValidateManifest,
  deployManifestSchema,
  extractOpReferences,
  renderResourceUri,
  validateOpReferences,
  type DeployManifest,
} from '@frontmcp/adapters/skills';
```

## See Also

- `references/deploy-to-cloudflare-skills-only.md` — the runtime that consumes the manifest
- Docs: https://docs.agentfront.dev/frontmcp/deployment/deploy-manifest
- Docs: https://docs.agentfront.dev/frontmcp/features/skills-only-deployment
