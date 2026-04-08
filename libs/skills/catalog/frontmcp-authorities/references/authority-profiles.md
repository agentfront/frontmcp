---
name: authority-profiles
description: Registering, composing, and using named authority profiles for reusable authorization policies
---

# Authority Profiles

Named authority profiles let you define reusable authorization policies once and reference them by name in entry decorators. Instead of repeating inline policy objects across dozens of tools, you register profiles in `@FrontMcp({ authorities: { profiles } })` and use `authorities: 'profileName'` on entries.

## Registering Profiles

Profiles are registered in the `profiles` field of the `authorities` config. Each key is the profile name, and the value is an `AuthoritiesPolicyMetadata` object.

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  name: 'my-server',
  authorities: {
    claimsMapping: { roles: 'realm_access.roles', permissions: 'scope' },
    profiles: {
        // RBAC: user must have at least one of these roles
        admin: {
          roles: { any: ['admin', 'superadmin'] },
        },

        // ABAC: user must be authenticated (sub exists)
        authenticated: {
          attributes: {
            conditions: [{ path: 'user.sub', op: 'exists', value: true }],
          },
        },

        // ABAC: tenant from JWT must match the tenantId input argument
        matchTenant: {
          attributes: {
            conditions: [
              { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } },
            ],
          },
        },

        // RBAC: permission-based
        canPublish: {
          permissions: { all: ['content:publish'] },
        },

        // Combined: role AND permission
        editorWithPublish: {
          roles: { any: ['editor'] },
          permissions: { all: ['content:publish'] },
          // operator defaults to 'AND', so both must pass
        },
      },
    },
  },
})
export class MyServer {}
```

## Using Profiles in Decorators

### Single Profile (String)

The simplest form. The named profile's policy is evaluated. If the profile is not registered, the request is denied with `"profile 'name' is not registered"`.

```typescript
@Tool({ name: 'delete_user', authorities: 'admin' })
export default class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string }) {
    // only admin or superadmin can reach here
  }
}

@Resource({
  name: 'internal-metrics',
  uri: 'metrics://internal',
  authorities: 'admin',
})
export default class InternalMetricsResource extends ResourceContext {
  async read() {
    // only admin can read this resource
  }
}

@Prompt({
  name: 'admin-report',
  authorities: 'admin',
})
export default class AdminReportPrompt extends PromptContext {
  async execute() {
    // only admin can use this prompt
  }
}
```

### Multiple Profiles (String Array)

When an array of profile names is provided, they are evaluated with AND semantics -- all profiles must pass.

```typescript
@Tool({
  name: 'update_tenant_billing',
  authorities: ['authenticated', 'matchTenant', 'admin'],
})
export default class UpdateTenantBillingTool extends ToolContext {
  async execute(input: { tenantId: string; plan: string }) {
    // user must be: authenticated AND in the matching tenant AND admin
  }
}
```

### Inline Policy (Object)

For one-off policies that do not need to be reused, pass an `AuthoritiesPolicyMetadata` object directly.

```typescript
@Tool({
  name: 'view_own_profile',
  authorities: {
    attributes: {
      conditions: [{ path: 'user.sub', op: 'exists', value: true }],
    },
  },
})
export default class ViewOwnProfileTool extends ToolContext {
  async execute() {
    // any authenticated user
  }
}
```

## Composing Profiles with Combinators

For complex authorization logic, use `allOf`, `anyOf`, and `not` combinators within inline policies. Profiles and inline policies can be mixed.

### allOf (AND)

All nested policies must pass.

```typescript
@Tool({
  name: 'deploy_to_production',
  authorities: {
    allOf: [
      { roles: { any: ['deployer', 'admin'] } },
      { attributes: { conditions: [{ path: 'env.NODE_ENV', op: 'eq', value: 'production' }] } },
      { permissions: { all: ['deployments:create'] } },
    ],
  },
})
export default class DeployTool extends ToolContext { ... }
```

### anyOf (OR)

At least one nested policy must pass.

```typescript
@Tool({
  name: 'manage_content',
  authorities: {
    anyOf: [
      { roles: { any: ['admin'] } },
      {
        // editor who is in the same tenant
        roles: { any: ['editor'] },
        attributes: {
          conditions: [
            { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } },
          ],
        },
      },
    ],
  },
})
export default class ManageContentTool extends ToolContext { ... }
```

### not (Negation)

Inverts a nested policy.

```typescript
@Tool({
  name: 'public_read_only',
  authorities: {
    not: { roles: { any: ['blocked', 'suspended'] } },
  },
})
export default class PublicReadOnlyTool extends ToolContext { ... }
```

### operator Field

The `operator` field controls how top-level fields within a single policy are combined. It defaults to `'AND'`.

```typescript
// Both roles AND permissions must pass (default AND)
authorities: {
  roles: { any: ['editor'] },
  permissions: { all: ['content:write'] },
  operator: 'AND',
}

// Either roles OR permissions must pass
authorities: {
  roles: { any: ['admin'] },
  permissions: { any: ['content:admin'] },
  operator: 'OR',
}
```

**Important:** `operator` applies to the fields within a single `AuthoritiesPolicyMetadata` object. For composing multiple independent policies, use `allOf`/`anyOf`.

## Type-Safe Profile Names

Augment the global `FrontMcpAuthorityProfiles` interface to get compile-time checks on profile name strings.

```typescript
// types/authorities.d.ts
declare global {
  interface FrontMcpAuthorityProfiles {
    admin: true;
    authenticated: true;
    matchTenant: true;
    canPublish: true;
    editorWithPublish: true;
  }
}

export {};
```

With this augmentation, `authorities: 'nonexistent'` will produce a TypeScript error.

## List Filtering Behavior

The authorities system does not only enforce on execution. The built-in `filterByAuthorities` flow stages in `list-tools`, `list-resources`, and `list-prompts` flows filter out entries the caller is not authorized to see. This means:

- `tools/list` only returns tools the current user is authorized to call
- `resources/list` only returns resources the current user can read
- `prompts/list` only returns prompts the current user can get

This filtering happens automatically. No additional configuration is needed. Entries without an `authorities` field are always visible.

## Profile Design Guidelines

| Guideline | Example |
| --- | --- |
| Name profiles after the role or intent, not the technical check | `admin` not `hasAdminRole` |
| Keep profiles single-purpose | `matchTenant` does tenant check only; combine with `['authenticated', 'matchTenant']` |
| Use `allOf`/`anyOf` for complex compositions in inline policies | Do not create profiles that duplicate combinator logic |
| Document your profiles in a central file | `types/authorities.d.ts` with augmentation and comments |
| Test profiles with both authorized and unauthorized users | See `frontmcp-testing` skill for auth testing patterns |

## Reference

- Type: `AuthoritiesPolicyMetadata` in `libs/auth/src/authorities/authorities.types.ts`
- Registry: `AuthoritiesProfileRegistry` in `libs/auth/src/authorities/authorities.registry.ts`
- Engine: `AuthoritiesEngine` in `libs/auth/src/authorities/authorities.engine.ts`
- Related: `references/claims-mapping.md`, `references/rbac-abac-rebac.md`, `references/custom-evaluators.md`
