# @frontmcp/plugin-skilled-openapi

> Wrap your REST API as a **skilled MCP server** without rewriting any controllers.

This plugin lets a FrontMCP server consume **signed skill bundles** produced by an external pipeline (typically FrontMCP Cloud, from your customer's OpenAPI spec at CI time) and serve them as MCP **skills**. The MCP client only sees three meta-tools — `search_skill`, `load_skill`, `execute_action` — while the per-operation REST tools stay hidden behind the skill abstraction. This avoids the well-documented "tool overload" problem (Claude reliability degrades past ~20 tools, GPT Actions caps at 30, Cursor at 40) when wrapping a real-world API with hundreds of endpoints.

## How it works

```
OpenAPI spec  --(SaaS analyzer, signs)-->  spec.yaml + overlay.yaml   (signed bundle)
                                                  │
                                                  ▼
                          FrontMCP server with @frontmcp/plugin-skilled-openapi
                                                  │
                                                  ▼
   tools/list  ->  [search_skill, load_skill, execute_action, ...]
   skills/*    ->  curated skills (each carrying instructions + actions[])
   execute_action -> ABAC -> input validate -> HTTP -> output validate -> result
```

## Standards alignment

- **OpenAPI Overlay 1.0/1.1** — bundle is a standard OpenAPI spec plus an Overlay layering `x-frontmcp-skill: <id>` annotations on operations. Customers can hand-author overlays in any OpenAPI tool.
- **SEP-2076** (Agent Skills as a First-Class MCP Primitive, working-group draft) — skills surface via the SDK's skills primitive when the MCP client supports it, falling back to meta-tool-only mode otherwise.
- **Anthropic Agent Skills format** — skill content is markdown with progressive disclosure.

## Security model (MUST-HAVE defaults)

- **Mandatory bundle signing** (RS256/Ed25519 JWT-of-hashes per OPA's bundle model). `requireSignature: true` is the default; opt-out only via explicit `dev: true`.
- **RFC 8707 Resource Indicators** enforced on every JWT (per the 2026-03-15 MCP authorization spec). Confused-deputy class attacks blocked at admission.
- **SSRF defenses** layered: URL string check → host allowlist → post-DNS-resolution IP blocklist (RFC 1918, link-local incl. AWS/GCP/Azure metadata, loopback, ULA) → DNS-rebinding pin → per-host concurrency cap → optional egress proxy.
- **Bundle data treated as adversarial** even after signature verify (CVE-2025-6514 lesson). WHATWG `URL` only, RFC 7230 header validation, no shell-out, no `eval`, strict JSON Schema with `additionalProperties: false`.
- **Five-gate authorization stack**: bundle signature → inbound JWT (RFC 8707) → per-skill ABAC → credential allowlist → outbound SSRF + circuit breaker.
- **Indirect prompt injection** mitigations: `execute_action` returns a structured envelope; output schema validation is mandatory; response size capped; optional sanitizer hook.

See the OWASP MCP Top 10 (2026) coverage table in the plan document for full mapping.

## Status

⚠️ Under active development for FrontMCP v1.2.0. The wire format and SaaS push API are subject to change while SEP-2076 firms up.
