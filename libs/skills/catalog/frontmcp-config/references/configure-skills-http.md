---
name: configure-skills-http
description: Full reference for skillsConfig — HTTP catalog endpoints, auth, caching, instructions injection, and tamper-evident audit log.
tags: [config, skills, skills-http, llm-txt, instructions, audit, injection]
---

# Configure `skillsConfig`

`skillsConfig` is the single configuration object on `@FrontMcp({ ... })` that controls everything about the Skills HTTP surface (`/skills`, `/llm.txt`, `/llm_full.txt`), the MCP `skill://` resource catalog (SEP-2640 — singular scheme), the auto-injected `instructions` field on the MCP `initialize` response, and the tamper-evident skill audit log.

## Top-Level Shape

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MainApp],

  // Server-level instructions, exposed as `instructions` on initialize.
  // Combined with the skill catalog summary per skillsConfig.injectInstructions.
  instructions: 'You are a helpful assistant for booking flights.',

  skillsConfig: {
    enabled: true, // turn on /skills, /llm.txt, /skill:// resources
    mcpResources: true, // expose skills as MCP resources (skill://index.json, skill://<skillPath>/SKILL.md)
    llmTxt: true, // serve /llm.txt
    llmFullTxt: false, // serve /llm_full.txt (full SKILL.md bodies)
    auth: 'api-key', // 'inherit' (default) | 'public' | 'api-key' | 'bearer'
    apiKeys: ['sk-xxx', 'sk-yyy'],
    jwt: { issuer: 'https://auth.example.com', audience: 'skills-api' },
    cache: {
      enabled: true,
      redis: { provider: 'redis', host: 'localhost', port: 6379 },
      ttlMs: 60_000,
    },
    injectInstructions: 'append', // 'off' | 'append' | 'prepend' | 'replace'
    audit: {
      enabled: true,
      signer: customSigner, // SkillAuditSigner — see audit section below
      store: customStore, // SkillAuditStore — see audit section below
      subjectMode: 'hash', // 'plain' | 'hash' | 'omit'
      headAnchorIntervalMs: 300_000,
    },
  },
})
class MyServer {}
```

## Server-Level `instructions`

The new top-level `instructions?: string` field on `@FrontMcp` is forwarded verbatim into the MCP `initialize` response. MCP clients use it as the global system prompt for the connected server.

| Field          | Type     | Default | Description                                                             |
| -------------- | -------- | ------- | ----------------------------------------------------------------------- |
| `instructions` | `string` | `''`    | High-level prompt the server gives to the LLM client at connection time |

`skillsConfig.injectInstructions` controls whether (and how) FrontMCP appends a generated **skill catalog summary** to those instructions on every `initialize` request.

## Skill Catalog Injection Policy

| Mode      | Behavior                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`     | The catalog summary is suppressed. Server `instructions` and channel hints are still surfaced.                                                                                                  |
| `append`  | Server `instructions`, then channel hints, then the catalog summary, joined by `\n\n---\n\n`. **(Default.)**                                                                                    |
| `prepend` | Catalog summary first, then channel hints, then server `instructions`.                                                                                                                          |
| `replace` | Surface ONLY the server `instructions`; the catalog AND channel hints are dropped. When `instructions` is empty/undefined this falls back to `'append'` so a misconfig doesn't drop everything. |

The catalog summary is built by `composeInitializeInstructions(...)` and `buildSkillsCatalogSummary(...)` (exported from `@frontmcp/sdk`). It is bounded at **16 KB** with a truncation footer; the footer points clients at `skill://index.json` and `skill://{skillPath}/SKILL.md` for full content (SEP-2640 — singular scheme).

> **Dynamic skills:** because the composer recomputes the summary on every `initialize` request, skills registered after server boot **are** picked up automatically.

## Skills HTTP Authentication

```typescript
// API key auth
skillsConfig: {
  enabled: true,
  auth: 'api-key',
  apiKeys: [process.env.SKILLS_API_KEY!],
}

// JWT bearer auth
skillsConfig: {
  enabled: true,
  auth: 'bearer',
  jwt: {
    issuer: 'https://auth.example.com',
    audience: 'skills-api',
  },
}
```

When `auth` is omitted it defaults to `'inherit'`, which means the Skills HTTP
surface adopts whatever authentication policy the parent server enforces
(typically the same `auth` block on `@FrontMcp(...)`). Use `'public'`
explicitly to opt out of authentication; use `'api-key'` or `'bearer'` to
override the inherited policy with a Skills-specific one. **In production,
set `auth` explicitly so the policy is visible at the call site.**

## Skills HTTP Caching

```typescript
skillsConfig: {
  enabled: true,
  cache: {
    enabled: true,
    // memory cache (default): no redis option
    // distributed cache: pass redis options
    redis: { provider: 'redis', host: 'localhost', port: 6379 },
    ttlMs: 60_000,
  },
}
```

Memory cache is the default; for multi-pod deployments use Redis or another supported provider.

## Audit Log

`skillsConfig.audit` enables a tamper-evident, hash-chained audit log of skill action executions (authority pass / authority fail / HTTP success / HTTP failure phases). Records are signed and chained so that any later mutation breaks verification.

| Field                  | Type                          | Default   | Description                                                                                               |
| ---------------------- | ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `enabled`              | `boolean`                     | `false`   | Turn the audit writer on                                                                                  |
| `signer`               | `SkillAuditSigner`            | dev HS256 | The signer used to sign each record. **Use `Rs256AuditSigner` in production.**                            |
| `store`                | `SkillAuditStore`             | memory    | Where records are persisted. Use `StorageAdapterAuditStore` for Redis/Vercel KV/SQLite-backed persistence |
| `subjectMode`          | `'plain' \| 'hash' \| 'omit'` | `'hash'`  | Redaction policy for the subject (e.g., user ID) embedded in each record                                  |
| `headAnchorIntervalMs` | `number`                      | unset     | Periodically anchor the chain head out-of-band so tail truncation is detectable (queued for v1.3.0 use)   |

**Production constraint:** `Hs256AuditSigner` initialized with an in-memory `randomBytes` key refuses to fire when `NODE_ENV === 'production'`. The recommended production pattern is `Rs256AuditSigner` reusing the bundle-signing keypair.

**Multi-pod constraint (v1.2.0):** the audit chain is **single-writer**. Running multiple pods that share the same `SkillAuditStore` will produce a loud warning; CAS-based atomic chain-head updates are queued for v1.3.0. Until then, route audit writes to a single elected leader pod or to per-pod chains that you stitch offline.

See [`skill-audit-log`](../../frontmcp-extensibility/references/skill-audit-log.md) for the full architecture, threat model, custom signer / custom store recipes, and chain verification with `verifyChain(...)`.

## Decision Matrix

| Situation                                 | Recommended setting                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local dev, no skills                      | `skillsConfig` unset                                                                                  |
| Public server, hand-curated server prompt | `instructions: '...'`, `injectInstructions: 'off'`                                                    |
| Server with many dynamic skills           | `injectInstructions: 'append'` (default) or `'replace'` if you want skills to drive the entire prompt |
| Multi-pod production                      | `cache: { enabled: true, redis: {...} }`, `audit: { signer: Rs256, store: StorageAdapterAuditStore }` |
| Compliance / forensic requirements        | RS256 signer + persistent store + scheduled `verifyChain(...)` in CI                                  |

## Examples

| Example                                                                           | Level    | Description                                                                                                 |
| --------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| [`inject-instructions`](../examples/configure-skills-http/inject-instructions.md) | Basic    | Set a server-level instructions string and append the skill catalog summary on every initialize response.   |
| [`audit-log-basic`](../examples/configure-skills-http/audit-log-basic.md)         | Basic    | Enable the skill audit log with the in-memory store and HS256 signer for development and tests.             |
| [`audit-log-redis`](../examples/configure-skills-http/audit-log-redis.md)         | Advanced | Production-grade audit log with the Redis-backed StorageAdapterAuditStore and the RS256 bundle-signing key. |

> See all examples in [`examples/configure-skills-http/`](../examples/configure-skills-http/)

## Reference

- [Skills HTTP](https://docs.agentfront.dev/frontmcp/features/skill-based-workflows)
- Related skills: `decorators-guide`, `skill-audit-log`, `vendor-integrations`
