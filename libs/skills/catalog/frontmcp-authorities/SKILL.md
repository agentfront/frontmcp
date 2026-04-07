---
name: frontmcp-authorities
description: 'Use when implementing authorization, access control, RBAC, ABAC, or ReBAC for tools, resources, or prompts. Covers JWT claims mapping, authority profiles, and policy enforcement.'
tags: [authorization, rbac, abac, rebac, security, permissions, roles, access-control, authorities, jwt]
category: development
targets: [all]
bundle: [full]
priority: 9
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/authentication/authorities
---

# FrontMCP Authorities

Built-in RBAC/ABAC/ReBAC authorization system for FrontMCP entry types. Each flow has native `checkEntryAuthorities` and `filterByAuthorities` stages that enforce access control policies declared via the `authorities` field on entry decorators. Configured via `@FrontMcp({ authorities: { claimsMapping, profiles, scopeMapping } })` — no plugin needed. Flow stages handle enforcement, and developers can hook into them with `Will`, `Did`, and `Around` decorators. Supports named profiles for reuse, JWT claims mapping for any identity provider, inline policies with roles/permissions/attributes/relationships, and composable combinators (`allOf`, `anyOf`, `not`).

## When to Use This Skill

### Must Use

- Adding role-based or permission-based access control to tools, resources, or prompts
- Restricting MCP entry visibility based on the caller's JWT claims
- Enforcing tenant isolation (ABAC) or relationship checks (ReBAC) on entries

### Recommended

- Setting up a multi-tenant server where different tenants see different tools
- Building an admin vs. user distinction across your MCP surface
- Combining multiple authorization models (e.g., RBAC + ABAC) on the same entry

### Skip When

- You only need authentication (login/token validation) without authorization (see `frontmcp-config` / `configure-auth`)
- You are building a public server with no access restrictions (use `mode: 'public'`)
- You need OAuth scopes at the transport level, not entry-level policies (see `configure-auth-modes`)

> **Decision:** Use this skill whenever you need to control **who can access which entries** based on roles, permissions, attributes, or relationships.

## CRITICAL: Ask About JWT Shape First

Before writing any authorities configuration, the coding agent **MUST** ask the developer:

> "What identity provider (IdP) are you using, and what does your JWT payload look like? I need to know where roles, permissions, and tenant ID are located in the claims."

**Why this matters:** Every IdP places roles and permissions in different JWT claim paths. Auth0 uses namespaced URIs (`https://myapp.com/roles`), Keycloak nests them under `realm_access.roles`, Okta uses `groups`, Cognito uses `cognito:groups`, and Frontegg uses flat `roles`/`permissions`. Writing `claimsMapping` without knowing the actual token shape will produce silent authorization failures where every user is denied.

**What to collect before proceeding:**

1. Identity provider name (Auth0, Keycloak, Okta, Cognito, Frontegg, custom)
2. A sample decoded JWT payload (redacted sensitive values)
3. The claim path for roles (e.g., `realm_access.roles`)
4. The claim path for permissions (e.g., `permissions` or `scope`)
5. The claim path for tenant/org ID if multi-tenant (e.g., `org_id`, `tenantId`)

See `references/claims-mapping.md` for IdP-specific claim paths.

## Prerequisites

- FrontMCP SDK installed (`@frontmcp/sdk`)
- `@frontmcp/auth` available (peer dependency of SDK, provides all authorities types)
- An authentication mode configured (see `frontmcp-config` / `configure-auth-modes`) so that `authInfo` is populated on incoming requests
- Knowledge of the developer's JWT token structure (see critical section above)

## Steps

### Step 1: Add the Authorities Config

Add the `authorities` field to your `@FrontMcp` decorator. No plugin import needed — authorities is a built-in framework feature.

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  name: 'my-server',
  authorities: {
    // configured in next steps
  },
})
export class MyServer {}
```

### Step 2: Configure JWT Claims Mapping

Set `claimsMapping` to tell the engine where roles, permissions, and user/tenant identifiers live in your IdP's JWT. Each value is a dot-path into the decoded JWT claims object.

```typescript
// Keycloak example — in @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'realm_access.roles',
    permissions: 'resource_access.my-client.roles',
    tenantId: 'org_id',
    userId: 'sub',
  },
}

// Auth0 example
authorities: {
  claimsMapping: {
    roles: 'https://myapp.com/roles',
    permissions: 'permissions',
    tenantId: 'org_id',
  },
}
```

If no `claimsMapping` is provided, the engine falls back to `authInfo.user.roles` and `authInfo.user.permissions`. For non-standard token shapes, use `claimsResolver` instead (see Common Patterns below).

### Step 3: Register Named Profiles

Profiles let you define reusable authorization policies and reference them by name in decorators. Register them in the `profiles` field.

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: { roles: 'realm_access.roles', permissions: 'scope' },
  profiles: {
    admin: {
      roles: { any: ['admin', 'superadmin'] },
    },
    authenticated: {
      attributes: {
        conditions: [{ path: 'user.sub', op: 'exists', value: true }],
      },
    },
    matchTenant: {
      attributes: {
        conditions: [
          { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } },
        ],
      },
    },
    editor: {
      permissions: { any: ['content:write', 'content:publish'] },
    },
  },
})
```

For type-safe profile names, augment the global interface:

```typescript
declare global {
  interface FrontMcpAuthorityProfiles {
    admin: true;
    authenticated: true;
    matchTenant: true;
    editor: true;
  }
}
```

### Step 4: Add Authorities to Entries

Use the `authorities` field on any entry decorator (`@Tool`, `@Resource`, `@Prompt`, `@Skill`). Three forms are supported:

**String (profile reference):**

```typescript
@Tool({ name: 'delete_user', authorities: 'admin' })
export default class DeleteUserTool extends ToolContext { ... }
```

**String array (multiple profiles, AND semantics):**

```typescript
@Tool({ name: 'update_tenant_settings', authorities: ['authenticated', 'matchTenant'] })
export default class UpdateTenantSettingsTool extends ToolContext { ... }
```

**Inline policy object:**

```typescript
@Tool({
  name: 'publish_content',
  authorities: {
    roles: { any: ['editor', 'admin'] },
    permissions: { all: ['content:publish'] },
  },
})
export default class PublishContentTool extends ToolContext { ... }
```

**Combinators for complex policies:**

```typescript
@Tool({
  name: 'sensitive_action',
  authorities: {
    allOf: [
      { roles: { any: ['admin'] } },
      { attributes: { conditions: [{ path: 'env.NODE_ENV', op: 'eq', value: 'production' }] } },
    ],
  },
})
export default class SensitiveActionTool extends ToolContext { ... }
```

## Scenario Routing Table

| Scenario | Approach | Reference |
| --- | --- | --- |
| Simple role gate (admin-only tool) | `authorities: 'admin'` profile | `references/authority-profiles.md` |
| Permission-based access | `authorities: { permissions: { all: ['x'] } }` | `references/rbac-abac-rebac.md` |
| Tenant isolation | ABAC with `{ fromInput: 'tenantId' }` | `references/rbac-abac-rebac.md` |
| Resource ownership check | ReBAC with relationship resolver | `references/rbac-abac-rebac.md` |
| IP allowlist or custom logic | Custom evaluator via `custom.*` | `references/custom-evaluators.md` |
| Different IdP (Auth0/Keycloak/Okta) | Configure `claimsMapping` | `references/claims-mapping.md` |
| Admin OR (editor AND same-tenant) | `anyOf` / `allOf` combinators | `references/authority-profiles.md` |
| Custom pre/post authority logic | Hook with `Will`/`Did`/`Around` on `checkEntryAuthorities` stage | `references/custom-evaluators.md` |
| Replace built-in check with OPA/Cedar | `Around('checkEntryAuthorities')` hook | `references/custom-evaluators.md` |
| Audit authority decisions | `Did('checkEntryAuthorities')` hook for logging/metrics | `references/custom-evaluators.md` |
| Tenant allowlist in Redis/DB | Async custom evaluator with `custom.*` field | `references/custom-evaluators.md` |
| Subscription check before tool runs | Async custom evaluator or `Will('checkEntryAuthorities')` hook | `references/custom-evaluators.md` |
| Feature flag gate on a tool | Async custom evaluator checking flag service | `references/custom-evaluators.md` |

## Common Patterns

| Pattern | Correct | Incorrect | Why |
| --- | --- | --- | --- |
| Claims mapping | `claimsMapping: { roles: 'realm_access.roles' }` | `claimsMapping: { roles: 'roles' }` (for Keycloak) | Keycloak nests roles under `realm_access.roles`; using the wrong path silently resolves to `[]` |
| Profile reference | `authorities: 'admin'` | `authorities: { profile: 'admin' }` | Profiles are referenced as plain strings, not nested objects |
| Multiple profiles | `authorities: ['authenticated', 'matchTenant']` | `authorities: 'authenticated, matchTenant'` | Use an array, not a comma-separated string |
| Inline RBAC | `{ roles: { any: ['admin'] } }` | `{ roles: ['admin'] }` | `roles` expects an object with `all` and/or `any` arrays |
| Dynamic value ref | `{ fromInput: 'tenantId' }` | `'{{ tenantId }}'` | Use `DynamicValueRef` objects, not template strings |
| OR combinator | `{ anyOf: [policy1, policy2] }` | `{ operator: 'OR', ...policy1, ...policy2 }` | Use `anyOf` for clarity; `operator` applies to top-level fields within a single policy |
| ReBAC resolver | Register `relationshipResolver` in plugin options | Inline the DB query in the policy | The resolver is a separate interface; policies only declare the relationship to check |

## Verification Checklist

### Configuration

- [ ] `authorities: { ... }` is set on the `@FrontMcp` decorator
- [ ] `claimsMapping` paths match the actual JWT token structure from your IdP
- [ ] All profile names referenced in `authorities: 'name'` are registered in `profiles`
- [ ] Authentication mode is configured (not `public`) so `authInfo` is populated
- [ ] If using ReBAC, `relationshipResolver` is provided in plugin options

### Runtime

- [ ] Unauthenticated requests to protected entries receive a denial error
- [ ] Users with the correct roles/permissions can access their entries
- [ ] `tools/list` response omits entries the caller is not authorized to see
- [ ] ABAC conditions with `{ fromInput: ... }` resolve correctly from tool arguments
- [ ] Custom evaluators return proper `AuthoritiesResult` objects

### Type Safety

- [ ] `FrontMcpAuthorityProfiles` is augmented for type-safe profile references
- [ ] `@frontmcp/auth` is imported so the `authorities` field is available on decorators

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `profile 'admin' is not registered` | Profile used in decorator but not in `authorities.profiles` config | Add the profile to the `profiles` field in `@FrontMcp({ authorities })` |
| All users denied despite correct roles | `claimsMapping.roles` path does not match the actual JWT claim path | Decode a real JWT and verify the dot-path resolves to the roles array |
| `authorities` field not recognized on decorator | `@frontmcp/auth` not imported (metadata augmentation not active) | Add `import '@frontmcp/auth'` or import any type from `@frontmcp/auth/authorities` |
| ABAC condition always fails | `{ fromInput: 'tenantId' }` but tool input field is named `tenant_id` | The `fromInput` key must exactly match the tool's input schema field name |
| ReBAC always denies | No `relationshipResolver` provided | Implement `RelationshipResolver` and pass it to plugin options |
| Custom evaluator not found | Key in `custom.*` policy does not match registered evaluator name | Ensure the evaluator is registered with the same key used in the policy |
| List endpoints show all entries | No `authorities` config in `@FrontMcp()` or hook priority conflict | Verify `authorities: { ... }` is set on `@FrontMcp()` decorator |
| `AuthorityDeniedError` has no detail | `deniedBy` field shows generic message | Check the `evaluatedPolicies` array on the error for which policy type failed |

## Reference

- [Auth Architecture](https://docs.agentfront.dev/frontmcp/authentication/architecture) — Full three-layer model: server auth, auth providers, authorities, vault, scope challenges
- [Authorities Documentation](https://docs.agentfront.dev/frontmcp/authentication/authorities) — RBAC/ABAC/ReBAC details, profiles, combinators, hooking
- Source: `libs/auth/src/authorities/` (engine, types, evaluators), flow stages in `libs/sdk/src/tool/flows/`, `libs/sdk/src/resource/flows/`, `libs/sdk/src/prompt/flows/`, `libs/sdk/src/agent/flows/`
- Related skills: `frontmcp-config`, `frontmcp-development`, `frontmcp-extensibility`
