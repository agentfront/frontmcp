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
    enabled: true, // turn on /skills, /llm.txt, skill:// resources
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
    failOnInvalidSkills: true, // false: a 'strict' skill with a missing tool is logged, not fatal
    externalProvider: new RestSkillProvider({ mode: 'read-only' }), // external skill storage, see below
    audit: {
      enabled: true,
      signer: customSigner, // SkillAuditSigner — see audit section below
      store: customStore, // SkillAuditStore — see audit section below
      metrics: createSkillAuditMetrics({ createCounter }), // counts failed and dropped writes
      subjectMode: 'hash', // 'plain' | 'hash' | 'omit'
      subjectHashSecret: process.env.AUDIT_SUBJECT_HASH_SECRET, // optional HMAC key for 'hash', >= 32 bytes
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

The catalog summary is built by `composeInitializeInstructions(...)` and `buildSkillsCatalogSummary(...)` (exported from `@frontmcp/sdk`). It is bounded at **16 KB** with a truncation footer. Its header and footer point clients at `skill://index.json` (SEP-2640 — singular scheme), which lists each skill's `skill://<skillPath>/SKILL.md` URI. With `mcpResources: false` no `skill://` resource is served, so they point at the `skills/load` and `skills/search` methods instead, and `sep2640InInstructions` is ignored.

> **Dynamic skills:** because the composer recomputes the summary on every `initialize` request, skills registered after server boot **are** picked up automatically. Their `skill://<skillPath>/SKILL.md` resources follow too: a skill registered or removed after boot (`this.scope.skills.registerSkillContent()` / `unregisterSkill()`, a skill-bundle plugin) is added to or dropped from `resources/list`, and clients get `notifications/resources/list_changed`. Up to 1.9.4 `resources/list` named only the skills present at startup.

> **Per caller:** the summary (and the SEP-2640 `skill://` hints under `sep2640InInstructions`) is composed for the client that initializes, like `skills/list`: it only names skills whose `authorities` that caller satisfies and that the hookable `skills:filter` flow keeps, so a flag-disabled skill's name and description are left out. With nothing gating a skill the instructions are unchanged. Transports use `composeCallerInstructions(scope, { ctx })`, exported from `@frontmcp/sdk` for custom transports.

## Skills-Only Connections (`?mode=skills_only`)

A client that connects to the MCP endpoint with `?mode=skills_only` (for example a planner agent that reads skills and hands execution to sub-agents) gets no tools. The mode restricts tools only:

- `tools/list` returns no tools.
- `tools/call` is answered as for an unknown tool (`Tool "<name>" not found`), whether or not the tool exists. Tools a tool, resource, prompt, agent or job calls in process (`this.callTool()`) still run.
- `skills/search`, `skills/load`, `skills/list`, resources (`skill://` and the server's own) and prompts work as usual.

It works on every transport and protocol revision (streamable HTTP, legacy SSE, stateless HTTP, MCP 2026-07-28, `createFetchHandler()` and Workers) and in every auth mode. Each request that carries the query is in the mode, and a session opened with it stays in the mode for its later requests (legacy SSE's `/message` endpoint drops the query, the session keeps it). Both decisions are hookable flow stages: `http:request` → `resolveSkillsOnlyMode` marks the request, and `tools:call-tool` → `checkSkillsOnlyMode` refuses the call. Up to 1.9.4 the mode only applied to a session opened with a verified JWT, and `tools/call` still ran the tools.

## External Skill Storage

`skillsConfig.externalProvider` installs an `ExternalSkillProviderBase` subclass while the server starts, as `this.scope.skills.setExternalProvider()` does at runtime:

| Provider mode  | Behavior                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'read-only'`  | Skills are searched, listed and loaded through the provider. The server serves the skills methods even when it declares no skill itself.                   |
| `'persistent'` | Local skills stay the source of truth; `await this.scope.skills.syncToExternal()` copies them to the provider (added / updated / unchanged / removed ids). |

The provider is initialized (`initialize()`) before the server uses it. The value is checked by shape (`initialize`, `isReadOnly`, `search`, `load`, `list`, `count` and `syncSkills` functions), so a provider built against another copy of `@frontmcp/sdk` is accepted.

A read-only provider's skills are also served over `skill://`: `skill://index.json` lists each one as `skill://<name>/SKILL.md`, and the `skill://{+skillPath}/SKILL.md` template reads it (a registered skill of the same name wins). `resources/list` names a concrete `SKILL.md` resource for registered skills only: an external store sends no change events and may hold many skills, so its skills are discovered through the index and read through the template. `setExternalProvider()` is declared on `this.scope.skills` (`SkillRegistryInterface`); up to 1.9.4 it was only on the `SkillRegistry` class and nothing installed a provider at startup.

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

With `'inherit'`, `/skills`, `/llm.txt` and `/llm_full.txt` need the same credential
as the MCP endpoint (401/403 otherwise; only a public-mode server lets everyone in),
and skills with `authorities` are listed only for a caller whose verified claims
satisfy them. The other modes surface no claims, so gated skills are never served
over HTTP there, and `GET /skills/<gated id>` answers 404.

Custom routes that guard skills content should call `authorizeSkillHttpRequest(scope,
skillsConfig, request)` from `@frontmcp/sdk`, which covers every mode.
`createSkillHttpAuthValidator()` is only for an explicit `'api-key'` or `'bearer'`
(it returns `null` only for `'public'`); its validator only sees headers, so it
refuses every request under `'inherit'` or an unset `auth`, and code that treated
`null` as "no auth needed" must switch to `authorizeSkillHttpRequest`.

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
| `metrics`              | `SkillAuditMetrics`           | unset     | Counts failed and dropped writes. Build it with `createSkillAuditMetrics({ createCounter })`              |
| `subjectMode`          | `'plain' \| 'hash' \| 'omit'` | `'hash'`  | Redaction policy for the subject (e.g., user ID) embedded in each record                                  |
| `subjectHashSecret`    | `string \| Uint8Array`        | derived   | HMAC key for `'hash'` (at least 32 bytes). Unset: derived from the signer's key material (see below)      |
| `headAnchorIntervalMs` | `number`                      | unset     | Reserved for out-of-band head anchoring (tail-truncation detection); validated but not read yet           |

The audit module lives in `@frontmcp/adapters/skills`, which the SDK does not import. `@frontmcp/plugin-skilled-openapi` registers it when the plugin is installed; without the plugin, register it once at boot with `setSkillAuditFactory(() => auditModule)` (see `skill-audit-log`). With `audit.enabled` and no module registered, the server runs without the audit log in development and refuses to start when `NODE_ENV` is `production`; a `signer` and `store` do not replace the module.

**Subject hashes:** with `subjectMode: 'hash'` and no `subjectHashSecret`, the HMAC key is derived (HKDF) from the signer's key material, so the hashes change when the signing key does. Releases up to 1.9.4 derived it from the public `keyId`, so subject hashes written before an upgrade from them do not match the ones written after, unless `subjectHashSecret` was set. A signer with no key material to derive from (an HSM or KMS signer) records subjects as `'redacted'` and warns at startup; set `subjectHashSecret` to keep hashing.

**Production constraint:** without a `signer`, the SDK falls back to an HS256 signer with a random, process-local secret, and refuses to start when `NODE_ENV === 'production'`. A random secret also makes records unverifiable after a restart. Without a `store` it falls back to the in-memory store, and with audit enabled in production it refuses to start as well; the error names the fix (configure `store`, e.g. a `StorageAdapterAuditStore` over Redis). The recommended production pattern is `Rs256AuditSigner` reusing the bundle-signing keypair plus a `StorageAdapterAuditStore`.

**Multi-pod constraint:** the audit chain is **single-writer**. Pods that share the same `SkillAuditStore` can link records to the same tail, and `verifyChain` then reports a `prevHash` mismatch; nothing warns at write time. Route audit writes to a single elected leader pod or to per-pod chains that you stitch offline.

See [`skill-audit-log`](../../frontmcp-extensibility/references/skill-audit-log.md) for the full architecture, threat model, custom signer / custom store recipes, and chain verification with `verifyChain(...)`.

## Decision Matrix

| Situation                                 | Recommended setting                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local dev, no skills                      | `skillsConfig` unset                                                                                  |
| Public server, hand-curated server prompt | `instructions: '...'`, `injectInstructions: 'off'`                                                    |
| Server with many dynamic skills           | `injectInstructions: 'append'` (default) or `'prepend'` if skill guidance must lead the prompt        |
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
