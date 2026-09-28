# Breaking Changes - FrontMCP v1.0.0

> This document is generated from `breaking-changes.v1.json`. Do not edit manually.

---

## BC-001: Remove @frontmcp/plugins meta-package

**Package:** `@frontmcp/plugins` | **Category:** removal | **Severity:** high

Replace all @frontmcp/plugins imports with direct plugin package imports: @frontmcp/plugin-cache, @frontmcp/plugin-codecall, @frontmcp/plugin-dashboard, @frontmcp/plugin-remember.

**Before:**

```typescript
import { CachePlugin } from '@frontmcp/plugins';
```

**After:**

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';
```

**Codemod available:** yes

---

## BC-002: Remove LoadSkillTool alias

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** low

Rename LoadSkillTool to LoadSkillsTool (note the plural 's').

**Before:**

```typescript
import { LoadSkillTool } from '@frontmcp/sdk';
```

**After:**

```typescript
import { LoadSkillsTool } from '@frontmcp/sdk';
```

**Codemod available:** yes

---

## BC-003: Remove ContextStorage alias

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** low

Rename ContextStorage to FrontMcpContextStorage.

**Before:**

```typescript
import { ContextStorage } from '@frontmcp/sdk';
```

**After:**

```typescript
import { FrontMcpContextStorage } from '@frontmcp/sdk';
```

**Codemod available:** yes

---

## BC-004: Remove authInfo getter on ExecutionContextBase

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** medium

Replace direct property access `this.authInfo` with method call `this.getAuthInfo()` in tool/resource/prompt contexts.

**Before:**

```typescript
this.authInfo;
```

**After:**

```typescript
this.getAuthInfo();
```

**Codemod available:** yes

---

## BC-005: Remove session token from FrontMcpTokens

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** low

Remove any references to FrontMcpTokens.session.

**Before:**

```typescript
FrontMcpTokens.session;
```

**After:**

```typescript
No replacement - session token was unused.
```

**Codemod available:** no

---

## BC-006: Remove session/request aliases on ProviderViews

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** medium

Replace `views.session` and `views.request` with `views.context`.

**Before:**

```typescript
views.session or views.request
```

**After:**

```typescript
views.context;
```

**Codemod available:** yes

---

## BC-007: Remove deprecated createTemplateHelpersLocal from SDK

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** low

Use createTemplateHelpers from @frontmcp/uipack/runtime instead of the deprecated local version.

**Before:**

```typescript
import { createTemplateHelpersLocal } from '@frontmcp/sdk';
```

**After:**

```typescript
import { createTemplateHelpers } from '@frontmcp/uipack/runtime';
```

**Codemod available:** yes

---

## BC-008: Remove legacy SSE transport

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** high

Replace SSEServerTransport with RecreateableSSEServerTransport which supports session recreation.

**Before:**

```typescript
import { SSEServerTransport } from '@frontmcp/sdk';
```

**After:**

```typescript
import { RecreateableSSEServerTransport } from '@frontmcp/sdk';
```

**Codemod available:** yes

---

## BC-009: Remove CimdCache alias

**Package:** `@frontmcp/auth` | **Category:** removal | **Severity:** low

Rename CimdCache to InMemoryCimdCache, or use the createCimdCache factory function.

**Before:**

```typescript
import { CimdCache } from '@frontmcp/auth';
```

**After:**

```typescript
import { InMemoryCimdCache } from '@frontmcp/auth';
```

**Codemod available:** yes

---

## BC-010: Remove dev-key-persistence module

**Package:** `@frontmcp/auth` | **Category:** removal | **Severity:** medium

Replace loadDevKey/saveDevKey/deleteDevKey with createKeyPersistence() from @frontmcp/utils.

**Before:**

```typescript
import { loadDevKey, saveDevKey } from '@frontmcp/auth';
```

**After:**

```typescript
import { createKeyPersistence } from '@frontmcp/utils';
```

**Codemod available:** no

---

## BC-011: Remove TransportIdGenerator.\_mode parameter

**Package:** `@frontmcp/auth` | **Category:** change | **Severity:** low

Remove the \_mode parameter from TransportIdGenerator.createId() calls.

**Before:**

```typescript
TransportIdGenerator.createId('jwt');
```

**After:**

```typescript
TransportIdGenerator.createId();
```

**Codemod available:** yes

---

## BC-012: Remove WidgetServingModeLegacy type alias

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** low

Use WidgetServingMode instead of WidgetServingModeLegacy. Remove 'mcp-resource' value references.

**Before:**

```typescript
WidgetServingModeLegacy;
```

**After:**

```typescript
WidgetServingMode;
```

**Codemod available:** yes

---

## BC-013: Remove RuntimePayload interface

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** medium

Replace RuntimePayload with the appropriate specific runtime type.

**Before:**

```typescript
import { RuntimePayload } from '@frontmcp/uipack';
```

**After:**

```typescript
Use the specific runtime types instead.
```

**Codemod available:** no

---

## BC-014: Remove legacy renderer asset fields

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** medium

Remove legacy asset fields from renderer configuration. Use the CDN resource system for runtime dependencies.

**Before:**

```typescript
(reactRuntime, reactDomRuntime, markdownEngine, handlebarsRuntime);
```

**After:**

```typescript
Use the CDN resource system instead.
```

**Codemod available:** no

---

## BC-015: Remove legacy build options

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** medium

Remove deprecated build options: sampleInput, sampleOutput, injectAdapters, minify, platform.

**Before:**

```typescript
(sampleInput, sampleOutput, injectAdapters, minify, platform);
```

**After:**

```typescript
Use the updated build API.
```

**Codemod available:** no

---

## BC-016: Remove buildToolUIMulti and legacy build types

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** medium

Replace buildToolUIMulti with individual buildToolUI calls. Remove BuildTargetPlatform, MultiBuildOptions, MultiBuildResult type imports.

**Before:**

```typescript
import { BuildTargetPlatform, buildToolUIMulti } from '@frontmcp/uipack';
```

**After:**

```typescript
Use buildToolUI with individual targets.
```

**Codemod available:** no

---

## BC-017: Remove frontmcp/\* meta keys

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** low

Replace frontmcp/_ meta keys with ui/_ prefixed keys.

**Before:**

```typescript
FrontMCPMetaFields interface
```

**After:**

```typescript
Use ui/* prefixed meta keys.
```

**Codemod available:** yes

---

## BC-018: Remove deprecated transpiler functions

**Package:** `@frontmcp/uipack` | **Category:** removal | **Severity:** low

Replace executeTranspiledCode and transpileAndExecute with the bundler API.

**Before:**

```typescript
import { executeTranspiledCode, transpileAndExecute } from '@frontmcp/uipack';
```

**After:**

```typescript
Use the bundler API instead.
```

**Codemod available:** no

---

## BC-019: Remove DataTransformOptions alias

**Package:** `@frontmcp/adapters` | **Category:** removal | **Severity:** low

Rename DataTransformOptions to ResponseTransformOptions.

**Before:**

```typescript
import { DataTransformOptions } from '@frontmcp/adapters';
```

**After:**

```typescript
import { ResponseTransformOptions } from '@frontmcp/adapters';
```

**Codemod available:** yes

---

## BC-020: Remove dataTransforms field alias

**Package:** `@frontmcp/adapters` | **Category:** removal | **Severity:** low

Rename the dataTransforms field to responseTransforms in OpenAPI adapter configuration.

**Before:**

```typescript
dataTransforms: { ... }
```

**After:**

```typescript
responseTransforms: { ... }
```

**Codemod available:** yes

---

## BC-021: Remove deprecated reservePort

**Package:** `@frontmcp/testing` | **Category:** removal | **Severity:** low

Replace reservePort with acquirePort from the port registry.

**Before:**

```typescript
import { reservePort } from '@frontmcp/testing';
```

**After:**

```typescript
import { acquirePort } from '@frontmcp/testing';
```

**Codemod available:** yes

---

## BC-022: Remove legacy test constants

**Package:** `@frontmcp/testing` | **Category:** removal | **Severity:** low

Remove references to EXPECTED_FRONTMCP_TOOLS_LIST_META_KEYS and EXPECTED_FRONTMCP_TOOL_CALL_META_KEYS.

**Before:**

```typescript
(EXPECTED_FRONTMCP_TOOLS_LIST_META_KEYS, EXPECTED_FRONTMCP_TOOL_CALL_META_KEYS);
```

**After:**

```typescript
No replacement - these constants are no longer needed.
```

**Codemod available:** no

---

## BC-023: Remove ProviderScope.SESSION and ProviderScope.REQUEST

**Package:** `@frontmcp/di` | **Category:** removal | **Severity:** high

Replace ProviderScope.SESSION and ProviderScope.REQUEST with ProviderScope.CONTEXT. Both mapped to CONTEXT internally.

**Before:**

```typescript
scope: ProviderScope.SESSION or scope: ProviderScope.REQUEST
```

**After:**

```typescript
scope: ProviderScope.CONTEXT;
```

**Codemod available:** yes

---

## BC-026: Flatten auth modes

**Package:** `@frontmcp/auth` | **Category:** change | **Severity:** high

Replace mode: 'orchestrated' with mode: 'local' or mode: 'remote'. Remove the type sub-discriminator. Flatten remote provider fields to top level.

**Before:**

```typescript
auth: { mode: 'orchestrated', type: 'remote', remote: { provider: '...' } }
```

**After:**

```typescript
auth: { mode: 'remote', provider: '...' }
```

**Codemod available:** yes

---

## BC-027: Flatten remote provider fields to top level

**Package:** `@frontmcp/auth` | **Category:** change | **Severity:** high

Hoist remote.provider, remote.clientId, remote.clientSecret, remote.scopes to the top level of the auth config.

**Before:**

```typescript
auth: { mode: 'transparent', remote: { provider: '...', scopes: ['read'] } }
```

**After:**

```typescript
auth: { mode: 'transparent', provider: '...', scopes: ['read'] }
```

**Codemod available:** yes

---

## BC-028: Remove splitByApp auth restriction

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

Server-level auth is now allowed in splitByApp mode. Apps inherit server auth by default and can override per-app.

**Before:**

```typescript
splitByApp: true with auth?: never
```

**After:**

```typescript
splitByApp: true with server-level auth allowed
```

**Codemod available:** no

---

## BC-029: Single source of truth for auth schemas

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

Import auth types from @frontmcp/auth instead of @frontmcp/sdk internal paths.

**Before:**

```typescript
Auth schemas duplicated in libs/sdk/src/common/types/options/auth/ and libs/auth/src/options/
```

**After:**

```typescript
Auth schemas only in libs/auth/src/options/, imported via @frontmcp/auth
```

**Codemod available:** yes

---

## BC-030: Simplify advanced config nesting

**Package:** `@frontmcp/auth` | **Category:** change | **Severity:** medium

Simplify tokenStorage and cimd cache configuration to use flattened format.

**Before:**

```typescript
tokenStorage: { type: 'redis', config: { host: '...' } }
```

**After:**

```typescript
tokenStorage: 'memory' | { redis: { host: '...' } };
```

**Codemod available:** yes

---

## BC-031: inputSchema accepts ZodRawShape only

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

Pass a plain object (ZodRawShape) to inputSchema instead of z.object(). Remove z.object() wrapper.

**Before:**

```typescript
inputSchema: z.object({ name: z.string() });
```

**After:**

```typescript
inputSchema: {
  name: z.string();
}
```

**Codemod available:** yes

---

## BC-032: Remove rawInputSchema/rawOutputSchema from user-facing API

**Package:** `@frontmcp/sdk` | **Category:** removal | **Severity:** low

Remove rawInputSchema and rawOutputSchema from @Tool() decorator options. Use inputSchema with ZodRawShape format.

**Before:**

```typescript
@Tool({ rawInputSchema: {...} })
```

**After:**

```typescript
Use inputSchema with ZodRawShape instead.
```

**Codemod available:** yes

---

## BC-033: HTTP server binds loopback by default

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** high

The HTTP transport now binds 127.0.0.1 unless told otherwise. A server that said nothing about security previously published itself on every interface, and since auth is opt-in that put unauthenticated tools, jobs and telemetry on the network by default. If your server must be reachable from another host — a container, a VM, behind a reverse proxy — set `http.security.bindAddress: 'all'` (or a specific address), or set the `FRONTMCP_BIND_ADDRESS=all` environment variable, which needs no rebuild and is the right fit for a Dockerfile or compose file. Distributed builds (`frontmcp build --target distributed`, which sets `FRONTMCP_DEPLOYMENT_MODE=distributed`) still bind all interfaces automatically. Local development and stdio transports are unaffected.

**Before:**

```typescript
// no security config → server bound 0.0.0.0 (all interfaces)
```

**After:**

```typescript
http: {
  security: {
    bindAddress: 'all',
  },
} // or FRONTMCP_BIND_ADDRESS=all
```

**Codemod available:** no

---

## BC-034: HTTP server sends no CORS headers by default

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

CORS now defaults to off — no headers, so a browser will not let another origin read the response. The previous default reflected any request Origin, which meant any page a developer visited could read a local server's responses. If a browser on another origin needs access, configure it explicitly: `http.cors: { origin: [...] }`, or `http.cors: { origin: true }` to restore the old permissive behaviour. Non-browser clients are unaffected — CORS is not a server-side access control.

**Before:**

```typescript
// no cors config → { origin: true, credentials: false } (any origin reflected)
```

**After:**

```typescript
http: {
  cors: {
    origin: ['https://app.example.com'];
  }
}
```

**Codemod available:** no

## BC-035: DNS-rebinding protection (Host validation) is on by default

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

DNS-rebinding protection (`http.security.dnsRebindingProtection`) now defaults to ON. A request whose `Host` (or `X-Forwarded-Host`) is not one this server answers to gets a 403, before routing and before the body is read. This closes GHSA-mc9g-v2cp-vfff: a malicious page can rebind its own domain to the victim's loopback address and reach a local MCP server as a same-origin service, and neither loopback binding nor CORS prevents it.

When `allowedHosts` is not configured it is derived from what the process actually listens on: the loopback aliases (`localhost`, `127.0.0.1`, `[::1]`, with and without the bound port). Matching is case-insensitive and treats `host` and `host:80`/`host:443` as equal. A Unix-socket listener derives nothing — the socket's filesystem permissions are the boundary and a rebound browser cannot reach it — so Host checking is skipped there.

A server bound to a routable address (`0.0.0.0`, `::`, a specific NIC) is reached under a hostname the process cannot know, so a DERIVED list is NOT enforced there: FrontMCP logs a warning and leaves Host checking off until you name the public host. Set `http.security.dnsRebindingProtection.allowedHosts` (or the `FRONTMCP_ALLOWED_HOSTS` env var) on a proxied deployment to turn it on — the bound NIC address is then added to the list alongside your public name. To opt out entirely, set `http.security.dnsRebindingProtection.enabled: false`.

Also fixed: `strict: true` previously derived a port-less allow-list (`['localhost', '127.0.0.1']`) and compared it against a raw `Host`, so it rejected every request on a non-default port.

**Before:**

```typescript
// no security config → Host/Origin never validated (any Host accepted)
```

**After:**

```typescript
http: {
  security: {
    dnsRebindingProtection: {
      allowedHosts: ['api.example.com'];
    }
  }
}
```

**Codemod available:** no

## BC-036: Dashboard auth requires a token, and enabled/auth cover its MCP endpoint

**Package:** `@frontmcp/plugin-dashboard` | **Category:** change | **Severity:** medium

`dashboardAuthSchema` now rejects `auth.enabled: true` without a non-empty `auth.token`, so a half-configured dashboard fails at startup instead of serving. Previously the combination parsed cleanly and the token was never checked at all (GHSA-rgxj-434m-vxh3), so a dashboard an operator believed was protected was public. Set a token, or set `auth.enabled: false` if the dashboard is meant to be reachable without one.

`enabled` and `auth` now cover the dashboard's MCP endpoint and its tools (`dashboard:graph`, `dashboard:list-tools`, `dashboard:list-resources`), not only the page. With `enabled: false`, or with `NODE_ENV=production` and no `enabled`, the page and the MCP endpoint answer `404` and the tools refuse with `DASHBOARD_DISABLED` on every transport. To keep the dashboard in production, set `enabled: true` together with `auth`.

With `auth` on, the MCP endpoint needs the token too, in addition to the server's own authentication, which still applies first. An MCP client sends it as `Authorization: Bearer <token>` or, when `Authorization` carries the server's own token, as `x-frontmcp-dashboard-token: <token>`. `?token=` is accepted for the page only. The page, opened with the token, sets an HttpOnly, `SameSite=Strict` cookie (`frontmcp_dashboard`, `Secure` on https) that its own client uses. `createDirect` and stdio have no way to send the token, so with `auth` on the tools refuse there.

`basePath` moves only the page. The MCP endpoint stays at the dashboard app's route (`/dashboard`, after `http.entryPath`), and the page's client now uses it; it used `<basePath>/sse` before.

Consequence to plan for: on a server with non-public auth, the page's client carries the dashboard cookie but no server credential, so its graph and SSE stream get `401` from the server's authentication. Run the dashboard on a public/development server, or front it with a proxy that injects a credential, scoped to the dashboard's own routes (`/dashboard`, `/dashboard/sse` and `/dashboard/message`) and holding no grant beyond the dashboard scope. Injecting a server credential across the MCP endpoint instead would let any page on that origin issue arbitrary authenticated JSON-RPC.

Only the Node server (`bootstrap`, `createHandler`) serves the dashboard's route. `createFetchHandler`, `createDirect`, `connect()` and stdio serve the server's own apps; up to 1.8.2 they served the dashboard's scope instead whenever `DashboardApp` was in `apps`. They still serve it when `DashboardApp` is the only app.

Signature changes: `generateDashboardHtml(options, mcpPath?)` and `createDashboardAuthValidator(auth, surface = 'page')`.

Related: dashboard options are process-wide, and a second, CONFLICTING auth configuration in the same process now throws rather than silently replacing the first — accepting it would make one server's token valid on another's dashboard. Call `resetDashboardOptions()` between constructions if you build several servers serially.

**Before:**

```typescript
DashboardPlugin.init({ auth: { enabled: true } }); // parsed; neither the page nor the MCP endpoint checked a token
```

**After:**

```typescript
DashboardPlugin.init({ enabled: true, auth: { enabled: true, token: process.env.DASHBOARD_TOKEN } }); // MCP clients send it as Bearer or x-frontmcp-dashboard-token
```

**Codemod available:** no

## BC-037: register_job / register_workflow are no longer registered by default

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

`register_job` and `register_workflow` take a raw `script` string and register it as a dynamic job, so an MCP client that can reach them can run arbitrary code in the server process. They were added to the tool surface automatically whenever any app declared jobs (GHSA-58v2-gpcc-jmqv). They are now omitted unless the server opts in, and a call that reaches them without the opt-in fails with `DynamicJobRegistrationDisabledError`.

The opt-in is `jobs.allowDynamicRegistration`. It is in addition to — not instead of — the `create` permission check on the entry, so a server that turns it on still authorizes each registration.

The other management tools (`list_jobs`, `execute_job`, `get_job_status`, `remove_job`, and their `*_workflow` counterparts) are unaffected.

**Before:**

```typescript
@FrontMcp({ jobs: { enabled: true } }) // register_job and register_workflow were exposed
```

**After:**

```typescript
@FrontMcp({ jobs: { enabled: true, allowDynamicRegistration: true } })
```

**Codemod available:** no

## BC-038: approval and featureFlag without a plugin that enforces them stop the server

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

A server now refuses to start with `UnenforcedMetadataError`, naming the entries, when a tool, resource, resource template, prompt, skill or agent declares metadata that only a plugin enforces and no plugin that enforces it reaches the entry. That metadata is `approval` (`@frontmcp/plugin-approval`), `featureFlag` (`@frontmcp/plugin-feature-flags`), and any key a plugin declares with `@Plugin({ enforcesMetadata })`. Previously the field did nothing: an `approval: true` tool ran for anyone, and a flagged-off entry was listed and served.

A plugin reaches an entry when it is installed on the server, on the entry's app, or on another app of the same server (the approval and feature-flag gates also cover apps that have no plugin of their own). With `splitByApp`, every app is a server of its own and needs its own plugin. A tool declared inside an `@Agent` is reached only by plugins installed on that agent.

`@Agent({ approval })` and `@Agent({ featureFlag })` now reach the agent's `invoke_<agent>` tool, so an installed plugin gates the agent like a tool. They were ignored before.

Install the plugin that enforces the field, or remove the field. A custom plugin that enforces a metadata key of its own declares it with `enforcesMetadata` on the plugin class whose hooks enforce it.

**Before:**

```typescript
@Tool({ name: 'wipe_disk', approval: true }) // no ApprovalPlugin installed: the tool ran without approval
```

**After:**

```typescript
@FrontMcp({ apps: [OpsApp], plugins: [ApprovalPlugin.init()] }) // or remove `approval` from the tool
```

**Codemod available:** no

## BC-039: createFetchHandler() rejects a misconfigured server when it's called

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** low

On Node and Bun, `FrontMcpInstance.createFetchHandler()` now builds the server when it's called, so a misconfigured server (for example `approval` without its plugin, `authorities` without the `authorities` option, or a missing `JWT_SECRET` in production) rejects there with the same error `createDirect()` throws. Previously the handler was returned and its first request threw.

On edge isolates (Cloudflare Workers, Vercel Edge, Deno), the server is still built on the first request, because module evaluation there forbids timers, randomness and I/O. What the config settles on its own is checked when the handler is created (`assertStaticStartupConfig()`, which `createEdgeMcp()` also runs), and a build that fails later answers every request with a structured `500 server_misconfigured` and logs the error.

Let the awaited `createFetchHandler()` fail your startup (or catch it) instead of expecting the first request to report configuration errors.

**Before:**

```typescript
const handler = await FrontMcpInstance.createFetchHandler(config); // misconfigured: the first request threw
```

**After:**

```typescript
const handler = await FrontMcpInstance.createFetchHandler(config); // misconfigured: rejects here, like createDirect()
```

**Codemod available:** no

## BC-040: availableWhen.surface holds for agents, jobs and HTTP triggers

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

`availableWhen.surface` now applies to every caller the docs list, not only MCP clients. The model an agent runs, and `this.callTool()` in an agent's own code, call on the `'agent'` surface; job and workflow steps on `'job'`; webhook handlers on `'http-trigger'`. A tool whose `surface` leaves one of them out is no longer offered to, or run for, that caller. A tool's own `this.callTool()` stays unrestricted. MCP Apps' `ui/callServerTool` counts as `'mcp'`, and a task keeps the surface of the call that created it. `getCallSurface()` now also works inside prompts.

List every surface that should reach an entry, for example `surface: ['mcp', 'agent']`.

**Before:**

```typescript
@Tool({ name: 'lookup', availableWhen: { surface: ['mcp'] } }) // an agent's model could still call it
```

**After:**

```typescript
@Tool({ name: 'lookup', availableWhen: { surface: ['mcp', 'agent'] } }) // reachable by MCP clients and agents
```

**Codemod available:** no

## BC-041: An authorities rule that names an unknown profile stops the server

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** low

An `authorities` rule that names a profile not defined in `@FrontMcp({ authorities: { profiles } })`, alone or in a list, now stops the server at startup with `AuthConfigurationError: Invalid authorities rule: … names an unknown profile "admn"`, on every entry kind the startup check covers (tools, resources, resource templates, prompts, agents, tools inside agents and skills). Previously the server started and refused every caller at call time.

Fix the name, or define the profile.

**Before:**

```typescript
@Tool({ name: 'purge', authorities: 'admn' }) // started, then refused everyone
```

**After:**

```typescript
@Tool({ name: 'purge', authorities: 'admin' }) // an unknown name now stops the server at startup
```

**Codemod available:** no

## BC-042: OAuth: tokens name the server's real address; public-mode and allowlist fixes

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** low

- Through `createFetchHandler()`, the resource URL and a token's `iss` come from the request's URL; they were `http://undefined` and the boot-time issuer. A configured `issuer` or `local.issuer`, else `FRONTMCP_PUBLIC_URL`, takes precedence on every entry point. A deployment that sets `FRONTMCP_PUBLIC_URL` without `local.issuer` now issues tokens with that `iss`, so tokens issued before the upgrade are refused once and clients refresh or sign in again.
- An explicit `auth: { mode: 'public' }` answers `/oauth/authorize` and `/oauth/token` like a server without `auth` (an anonymous code to loopback redirect URIs only) instead of 500. Static mode answers 400.
- A `dcr.allowedClientIds` refusal of a registered client using its own `redirect_uri` redirects there with `error=unauthorized_client`; it was a 400 page.
- `scopes_supported` in both discovery documents lists the literal `allowedScopes` entries. `*` globs are granted but not advertised.

**Before:**

```typescript
// createFetchHandler: tokens carried aud "http://undefined" and the boot-time iss
```

**After:**

```typescript
// createFetchHandler: aud and iss from the request URL, unless issuer/local.issuer or FRONTMCP_PUBLIC_URL is set
```

**Codemod available:** no

## BC-043: OpenAPI adapter: a secured call needs a credential for its scheme on the request as sent

**Package:** `@frontmcp/adapters` | **Category:** change | **Severity:** medium

A secured operation is refused before any request, with `Authentication required for tool '…'`, unless the request as sent carries a credential for one of its schemes. Credentials can come from `staticAuth`, `authProviderMapper`, `securityResolver`, a header set by `additionalHeaders` or `headersMapper` (an API key in its named header, `Authorization` for bearer and OAuth2), or the tool input with `securitySchemesInInput` or `includeSecurityInInput`.

`passthroughCallerToken` fills only HTTP bearer schemes: an API-key or OAuth2 operation it can't satisfy is refused. Before, it was sent with no credential. When the server and the tool input both give a credential for a scheme, the server's wins. `securitySchemesInInput` is rated HIGH at startup, like `includeSecurityInInput`. `inputTransforms` and `headersMapper` also run for calls that are then refused.

Supply each scheme's credential from a server-side option.

**Before:**

```typescript
OpenapiAdapter.init({ ..., passthroughCallerToken: true }) // an API-key operation went out with no key
```

**After:**

```typescript
OpenapiAdapter.init({ ..., authProviderMapper: { ApiKeyAuth: (ctx) => keyFor(ctx) } }) // refused without a key
```

**Codemod available:** no

## BC-044: CodeCall reports syntax_error and tool_error

**Package:** `@frontmcp/plugin-codecall` | **Category:** change | **Severity:** low

CodeCall runs scripts with the tool namespaces and `throwOnError` of `@enclave-vm/core` 2.15.3. A parse error is now `syntax_error`, with the line and column in the script. A failing tool is `tool_error`, with the tool's error code (a time-out is `TIMEOUT`) and without the tool's arguments. The script's own errors stay `runtime_error`. Before, all three were `runtime_error`, and a tool time-out ended the script with status `timeout`.

A namespace call with `{ throwOnError: false }` returns the same `{ success, error }` shape as `callTool`. Namespaces whose tool names start with `_` aren't offered; call those tools with `callTool`.

Check `status` for the new kinds.

**Before:**

```typescript
if (result.status === 'runtime_error') {
  /* parse errors, tool failures and script errors */
}
```

**After:**

```typescript
switch (result.status) {
  case 'syntax_error':
  case 'tool_error':
  case 'runtime_error': /* ... */
}
```

**Codemod available:** no

## BC-045: A request is in a session only if it presented one

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** medium

A session counts as verified only when the request presented it (`mcp-session-id`, or a legacy SSE `sessionId`) and the server accepted it. Under MCP 2026-07-28, no request is in a session, even one that sends back an id the server issued. The id the server makes up for a request that has none is no longer a session.

State kept per session therefore falls back to the caller's identity: Remember `session` and `tool` memory, feature-flag targeting, approval session records, `CONTEXT` providers, elicitation owners, the secure store's `session` scope, and session-scoped auth-provider credentials. An unauthenticated caller without a session gets `RememberIdentityError` from Remember's session-scoped memory, and `SessionIdentityRequiredError` from the secure store's `session` scope. Legacy SSE sessions now count as verified, so approvals and rate-limit partitions apply per SSE session. A static-key caller is no longer anonymous: its results are cached `private`, and it can own 2026-07-28 tasks. `authInfoFromAuthorization(authorization, presentedSessionId?)` takes the presented id; without it, `extra.sessionId` isn't set.

For state that must outlive a request under 2026-07-28, sign callers in or use `user` scope.

**Before:**

```typescript
// 2026-07-28: every request got a new session id, so session-scoped memory lasted one request
```

**After:**

```typescript
// 2026-07-28: no session; session-scoped memory belongs to the signed-in caller (or refuses anonymous ones)
```

**Codemod available:** no

## BC-046: Durable Object sessions serve only the caller that opened them

**Package:** `@frontmcp/sdk` | **Category:** change | **Severity:** low

A Durable Object's stateful MCP session (`createEdgeMcp({ sessions })`) serves only the caller that opened it. Its `Mcp-Session-Id` addresses the Durable Object but is not an id `session:verify` can check against the caller's token, so the `http:request` flow's new `checkPersistentSessionOwner` stage binds the session to the caller of its first request, before every protocol handler (MCP 2026-07-28 included): its verified issuer and subject (a token refresh keeps them), else its token (an anonymous grant). The owner is kept in the Durable Object's storage, so an instance rebuilt after eviction keeps it. Any other caller that presents the id gets `404` with JSON-RPC error `-32001 Session not found` on `POST`, `GET` and `DELETE`, and the owner's session is untouched. On a public server, an anonymous caller without a token has no identity to bind, so the unguessable session id remains the only credential. The owner can now end its session with `DELETE`; before, every `DELETE` of a Durable Object session answered 404.

A client that shares one session between users, or signs in as a different user mid-session, must `initialize` a new session.

**Before:**

```typescript
// any caller presenting a Durable Object session's Mcp-Session-Id reached its persistent transport
```

**After:**

```typescript
// only the caller that opened the session; anyone else gets 404 Session not found
```

**Codemod available:** no
