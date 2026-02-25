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
import { buildToolUIMulti, BuildTargetPlatform } from '@frontmcp/uipack';
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
