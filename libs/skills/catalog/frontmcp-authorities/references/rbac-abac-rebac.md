---
name: rbac-abac-rebac
description: Comparison of RBAC, ABAC, and ReBAC authorization models with when to use each, policy syntax, and examples
---

# RBAC, ABAC, and ReBAC Models

The FrontMCP authorities system supports three authorization models that can be used independently or combined. This reference explains each model, its policy syntax, and when to choose it.

## Model Comparison

| Model     | Based On                                  | Strength                                   | Weakness                                      | Use When                                                |
| --------- | ----------------------------------------- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| **RBAC**  | User roles and permissions                | Simple, well-understood, fast              | No context awareness, role explosion at scale | Fixed role hierarchies (admin, editor, viewer)          |
| **ABAC**  | Attributes of user, resource, environment | Flexible, context-aware, fine-grained      | More complex to configure and debug           | Tenant isolation, environment gates, dynamic conditions |
| **ReBAC** | Relationships between users and resources | Models ownership and hierarchies naturally | Requires external relationship store          | Document ownership, team membership, org hierarchies    |

## RBAC -- Role-Based Access Control

RBAC checks whether the user has specific roles or permissions. Roles and permissions are extracted from JWT claims via `claimsMapping`.

### Roles Policy

```typescript
interface RbacRolesPolicy {
  /** User must have ALL of these roles (AND) */
  all?: string[];
  /** User must have at least ONE of these roles (OR) */
  any?: string[];
}
```

When both `all` and `any` are set, both conditions must be satisfied.

**Examples:**

```typescript
// User must be an admin
authorities: {
  roles: { any: ['admin', 'superadmin'] },
}

// User must have BOTH 'reviewer' AND 'approver' roles
authorities: {
  roles: { all: ['reviewer', 'approver'] },
}

// User must have 'editor' AND at least one of 'us-team' or 'eu-team'
authorities: {
  roles: {
    all: ['editor'],
    any: ['us-team', 'eu-team'],
  },
}
```

### Permissions Policy

Same structure as roles, but checked against the user's permissions array.

```typescript
interface RbacPermissionsPolicy {
  all?: string[];
  any?: string[];
}
```

**Examples:**

```typescript
// User must have the 'users:delete' permission
authorities: {
  permissions: { all: ['users:delete'] },
}

// User must have 'content:read' AND ('content:write' OR 'content:publish')
authorities: {
  permissions: {
    all: ['content:read'],
    any: ['content:write', 'content:publish'],
  },
}
```

### Combining Roles and Permissions

Within a single policy object, roles and permissions are combined using the `operator` field (default `'AND'`).

```typescript
// User must be an admin AND have 'users:delete' permission
authorities: {
  roles: { any: ['admin'] },
  permissions: { all: ['users:delete'] },
}

// User must be an admin OR have 'users:delete' permission
authorities: {
  roles: { any: ['admin'] },
  permissions: { all: ['users:delete'] },
  operator: 'OR',
}
```

## ABAC -- Attribute-Based Access Control

ABAC evaluates conditions against a context envelope containing `user`, `claims`, `input`, and `env`. This enables tenant isolation, environment-specific gates, and dynamic value matching.

### Context Envelope

The evaluation context has four top-level namespaces:

| Prefix     | Content                                                      | Example Path                        |
| ---------- | ------------------------------------------------------------ | ----------------------------------- |
| `user.*`   | Resolved user info (`sub`, `roles`, `permissions`, `claims`) | `user.sub`, `user.roles`            |
| `claims.*` | Raw JWT claims                                               | `claims.org_id`, `claims.email`     |
| `input.*`  | Tool/prompt input arguments                                  | `input.tenantId`, `input.projectId` |
| `env.*`    | Runtime environment variables                                | `env.NODE_ENV`, `env.REGION`        |

### Simple Match

The `match` field provides simple equality checks. All pairs must match (AND semantics).

```typescript
authorities: {
  attributes: {
    match: {
      'claims.org_id': 'tenant-abc',
      'env.NODE_ENV': 'production',
    },
  },
}
```

### Advanced Conditions

The `conditions` array supports operators. All conditions must pass (AND semantics).

```typescript
interface AbacCondition {
  path: string; // Dot-path into context envelope
  op: AbacOperator; // Comparison operator
  value: unknown; // Literal or DynamicValueRef
}
```

**Available operators:**

| Operator     | Description                       | Example                                                                     |
| ------------ | --------------------------------- | --------------------------------------------------------------------------- |
| `eq`         | Strict equality                   | `{ path: 'claims.tier', op: 'eq', value: 'enterprise' }`                    |
| `neq`        | Not equal                         | `{ path: 'claims.status', op: 'neq', value: 'suspended' }`                  |
| `in`         | Value is in array                 | `{ path: 'env.REGION', op: 'in', value: ['us-east', 'eu-west'] }`           |
| `notIn`      | Value is not in array             | `{ path: 'claims.role', op: 'notIn', value: ['blocked'] }`                  |
| `gt`         | Greater than (number)             | `{ path: 'claims.tokenVersion', op: 'gt', value: 2 }`                       |
| `gte`        | Greater than or equal             | `{ path: 'claims.apiQuota', op: 'gte', value: 100 }`                        |
| `lt`         | Less than (number)                | `{ path: 'claims.failCount', op: 'lt', value: 5 }`                          |
| `lte`        | Less than or equal                | `{ path: 'claims.riskScore', op: 'lte', value: 50 }`                        |
| `contains`   | String contains or array includes | `{ path: 'claims.email', op: 'contains', value: '@corp.com' }`              |
| `startsWith` | String starts with                | `{ path: 'user.sub', op: 'startsWith', value: 'service-' }`                 |
| `endsWith`   | String ends with                  | `{ path: 'claims.email', op: 'endsWith', value: '@acme.com' }`              |
| `exists`     | Value exists (not null/undefined) | `{ path: 'user.sub', op: 'exists', value: true }`                           |
| `matches`    | Regex match                       | `{ path: 'claims.email', op: 'matches', value: '^.*@(acme\|corp)\\.com$' }` |

### Dynamic Value References

Instead of hardcoding values, reference runtime data from tool input or JWT claims.

```typescript
// Match tenant from tool input
{ path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } }

// Match a value from another claim
{ path: 'claims.department', op: 'eq', value: { fromClaims: 'manager.department' } }
```

### ABAC Examples

**Tenant isolation:**

```typescript
@Tool({
  name: 'get_tenant_data',
  inputSchema: { tenantId: z.string() },
  authorities: {
    attributes: {
      conditions: [
        { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } },
      ],
    },
  },
})
export default class GetTenantDataTool extends ToolContext { ... }
```

**Environment gate:**

```typescript
@Tool({
  name: 'run_migration',
  authorities: {
    attributes: {
      conditions: [
        { path: 'env.NODE_ENV', op: 'in', value: ['staging', 'production'] },
        { path: 'claims.role', op: 'eq', value: 'dba' },
      ],
    },
  },
})
export default class RunMigrationTool extends ToolContext { ... }
```

**Authenticated user check:**

```typescript
authorities: {
  attributes: {
    conditions: [{ path: 'user.sub', op: 'exists', value: true }],
  },
}
```

## ReBAC -- Relationship-Based Access Control

ReBAC checks whether the authenticated user has a specific relationship to a named resource. This requires a `RelationshipResolver` that queries your authorization backend (SpiceDB, OpenFGA, custom database).

### Policy Syntax

```typescript
interface RebacPolicy {
  /** Relationship type (e.g., 'owner', 'member', 'viewer') */
  type: string;
  /** Resource type (e.g., 'document', 'site', 'org') */
  resource: string;
  /** Resource identifier -- literal, from input, or from claims */
  resourceId: ResourceIdRef;
}

type ResourceIdRef = string | { fromInput: string } | { fromClaims: string };
```

### Implementing a Relationship Resolver

The resolver is passed via the `authorities.relationshipResolver` config in `@FrontMcp()`. It must implement the `RelationshipResolver` interface.

```typescript
import type { RelationshipResolver, AuthoritiesEvaluationContext } from '@frontmcp/auth';

const myRelationshipResolver: RelationshipResolver = {
  async check(
    type: string,
    resource: string,
    resourceId: string,
    userSub: string,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<boolean> {
    // Example: query SpiceDB / OpenFGA / your database
    const result = await spiceDb.checkPermission({
      subject: { object: { objectType: 'user', objectId: userSub } },
      permission: type,
      resource: { objectType: resource, objectId: resourceId },
    });
    return result.permissionship === 'HAS_PERMISSION';
  },
};

// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: { roles: 'roles' },
  relationshipResolver: myRelationshipResolver,
  profiles: { ... },
}
```

### ReBAC Examples

**Document ownership:**

```typescript
@Tool({
  name: 'edit_document',
  inputSchema: { documentId: z.string() },
  authorities: {
    relationships: {
      type: 'owner',
      resource: 'document',
      resourceId: { fromInput: 'documentId' },
    },
  },
})
export default class EditDocumentTool extends ToolContext { ... }
```

**Team membership:**

```typescript
@Tool({
  name: 'view_team_dashboard',
  inputSchema: { teamId: z.string() },
  authorities: {
    relationships: {
      type: 'member',
      resource: 'team',
      resourceId: { fromInput: 'teamId' },
    },
  },
})
export default class ViewTeamDashboardTool extends ToolContext { ... }
```

**Multiple relationships (AND):**

```typescript
@Tool({
  name: 'approve_expense',
  inputSchema: { expenseId: z.string(), departmentId: z.string() },
  authorities: {
    relationships: [
      { type: 'manager', resource: 'department', resourceId: { fromInput: 'departmentId' } },
      { type: 'reviewer', resource: 'expense', resourceId: { fromInput: 'expenseId' } },
    ],
  },
})
export default class ApproveExpenseTool extends ToolContext { ... }
```

## Combining Models

The real power of the authorities system is combining models in a single policy. All fields within a policy are combined using `operator` (default `'AND'`).

**RBAC + ABAC (role AND tenant match):**

```typescript
authorities: {
  roles: { any: ['admin'] },
  attributes: {
    conditions: [
      { path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } },
    ],
  },
}
```

**RBAC + ReBAC (role AND document ownership):**

```typescript
authorities: {
  roles: { any: ['editor'] },
  relationships: {
    type: 'owner',
    resource: 'document',
    resourceId: { fromInput: 'documentId' },
  },
}
```

**Complex: admin bypasses ownership, others need ownership:**

```typescript
authorities: {
  anyOf: [
    { roles: { any: ['admin'] } },
    {
      roles: { any: ['editor'] },
      relationships: {
        type: 'owner',
        resource: 'document',
        resourceId: { fromInput: 'documentId' },
      },
    },
  ],
}
```

## Decision Guide

Use this guide to pick the right model for your use case:

| Question                                  | If Yes                                 | If No                  |
| ----------------------------------------- | -------------------------------------- | ---------------------- |
| Are roles/permissions defined in the IdP? | Start with RBAC                        | Consider ABAC or ReBAC |
| Do you need tenant isolation?             | Use ABAC with `{ fromInput: ... }`     | RBAC may suffice       |
| Do you need per-resource ownership?       | Use ReBAC with a relationship resolver | RBAC or ABAC           |
| Do you need environment-specific gates?   | Use ABAC with `env.*` paths            | Not needed             |
| Is the logic too complex for one model?   | Combine with `allOf`/`anyOf`           | Keep it simple         |

## Reference

- Types: `libs/auth/src/authorities/authorities.types.ts`
- Evaluators: `libs/auth/src/authorities/authorities.evaluator.ts`
- Context: `libs/auth/src/authorities/authorities.context.ts`
- Related: `references/claims-mapping.md`, `references/authority-profiles.md`, `references/custom-evaluators.md`
