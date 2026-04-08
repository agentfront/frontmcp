---
name: claims-mapping
description: JWT claims mapping configuration per identity provider (Auth0, Keycloak, Okta, Cognito, Frontegg) for the authorities system
---

# JWT Claims Mapping

The `claimsMapping` field in `@FrontMcp({ authorities: { claimsMapping } })` tells the authorities engine where to find roles, permissions, tenant ID, and user ID within the decoded JWT payload. Every identity provider structures its tokens differently, so this mapping is required for correct policy evaluation.

## How Claims Mapping Works

The engine receives `authInfo` on each request, which contains the decoded JWT claims. The `claimsMapping` fields are dot-paths resolved against these claims using `resolveDotPath()`. The resolver first tries a direct key lookup (for keys containing dots, such as Auth0 namespaced claims), then falls back to dot-separated path traversal.

```typescript
interface AuthoritiesClaimsMapping {
  /** Dot-path to roles array in JWT claims */
  roles?: string;
  /** Dot-path to permissions array/string in JWT claims */
  permissions?: string;
  /** Dot-path to tenant/org ID in JWT claims */
  tenantId?: string;
  /** Dot-path to user ID in JWT claims (default: 'sub') */
  userId?: string;
  /** Extensible: additional custom claim mappings */
  [key: string]: string | undefined;
}
```

## Auth0

Auth0 stores roles in a custom namespaced claim (you define the namespace) and permissions in a flat `permissions` array. The org ID (if using Auth0 Organizations) is in `org_id`.

**Sample JWT payload:**

```json
{
  "sub": "auth0|abc123",
  "https://myapp.com/roles": ["admin", "editor"],
  "permissions": ["users:read", "users:write", "content:publish"],
  "org_id": "org_def456",
  "aud": "https://api.myapp.com",
  "iss": "https://myapp.auth0.com/"
}
```

**Claims mapping:**

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'https://myapp.com/roles',
    permissions: 'permissions',
    tenantId: 'org_id',
  },
}
```

**Notes:**

- The roles claim namespace (`https://myapp.com/roles`) is configured in an Auth0 Action or Rule. It must be a fully qualified URL.
- `resolveDotPath` handles the dotted namespace key via direct key lookup, so `https://myapp.com/roles` works correctly.
- Permissions appear only if the API has RBAC enabled in Auth0 dashboard.

## Keycloak

Keycloak nests realm roles under `realm_access.roles` and client-specific roles under `resource_access.<client-id>.roles`. Permissions are typically modeled as client roles or fine-grained UMA permissions.

**Sample JWT payload:**

```json
{
  "sub": "f1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "realm_access": {
    "roles": ["admin", "user", "offline_access"]
  },
  "resource_access": {
    "my-client": {
      "roles": ["content:write", "content:publish"]
    },
    "account": {
      "roles": ["manage-account"]
    }
  },
  "preferred_username": "jane.doe",
  "azp": "my-client",
  "iss": "https://keycloak.example.com/realms/myrealm"
}
```

**Claims mapping:**

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'realm_access.roles',
    permissions: 'resource_access.my-client.roles',
  },
}
```

**Notes:**

- Replace `my-client` with your actual Keycloak client ID.
- Keycloak adds system roles like `offline_access` and `uma_authorization` to `realm_access.roles`. You may want to use `all` instead of `any` in RBAC policies to avoid matching on these.
- For multi-tenant Keycloak setups, tenant ID is often a custom claim added via a protocol mapper.

## Okta

Okta uses `groups` for role-like claims and `scp` (or `scope`) for permission-like claims. Groups must be explicitly included in the token via an Authorization Server claim configuration.

**Sample JWT payload:**

```json
{
  "sub": "00u1a2b3c4d5e6f7g8h9",
  "groups": ["Admin", "Engineering", "Everyone"],
  "scp": ["openid", "profile", "users.read", "users.write"],
  "cid": "0oa1b2c3d4e5f6g7h8",
  "uid": "00u1a2b3c4d5e6f7g8h9",
  "iss": "https://myorg.okta.com/oauth2/default"
}
```

**Claims mapping:**

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'groups',
    permissions: 'scp',
  },
}
```

**Notes:**

- Groups must be added as a claim to the authorization server. Go to Security > API > Authorization Servers > Claims > Add Claim with value type "Groups" and filter "Matches regex `.*`".
- `scp` is an array of scope strings. If your Okta config uses `scope` (singular), adjust the path accordingly.
- Okta does not have a built-in org/tenant claim. For multi-tenant, add a custom claim via a token hook.

## Amazon Cognito

Cognito uses `cognito:groups` for groups and `scope` (space-separated string) for OAuth scopes. Custom attributes use the `custom:` prefix.

**Sample JWT payload:**

```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cognito:groups": ["Admins", "PowerUsers"],
  "scope": "openid profile aws.cognito.signin.user.admin",
  "custom:tenantId": "tenant-abc",
  "client_id": "1a2b3c4d5e6f7g8h9i0j",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfG"
}
```

**Claims mapping:**

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'cognito:groups',
    permissions: 'scope',
    tenantId: 'custom:tenantId',
  },
}
```

**Notes:**

- `scope` in Cognito is a space-separated string, not an array. The authorities engine handles this automatically via `toStringArray()`, which splits space-separated strings.
- `cognito:groups` contains dots in the key name. `resolveDotPath` handles this via direct key lookup.
- Custom attributes require the `custom:` prefix in both the claim path and the User Pool schema.

## Frontegg

Frontegg places roles and permissions as flat arrays at the top level. Tenant ID is in `tenantId`. The token also includes `tenantIds` (array of all tenant memberships) for multi-tenant scenarios.

**Sample JWT payload:**

```json
{
  "sub": "user-uuid-123",
  "roles": ["Admin", "ReadOnly"],
  "permissions": ["fe.users.read", "fe.users.write", "fe.tenant.admin"],
  "tenantId": "tenant-uuid-456",
  "tenantIds": ["tenant-uuid-456", "tenant-uuid-789"],
  "email": "jane@example.com",
  "iss": "https://app-abc.frontegg.com"
}
```

**Claims mapping:**

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsMapping: {
    roles: 'roles',
    permissions: 'permissions',
    tenantId: 'tenantId',
  },
}
```

**Notes:**

- Frontegg tokens have the simplest structure since roles and permissions are flat top-level arrays.
- The default fallback behavior (no `claimsMapping`) already looks for `roles` and `permissions` at the top level, so Frontegg often works without explicit mapping.
- For cross-tenant operations, use `tenantIds` (array) instead of `tenantId` (single active tenant).

## Custom IdP / claimsResolver

If your JWT structure does not fit the dot-path model, use `claimsResolver` instead of `claimsMapping`. This gives full programmatic control over claim extraction.

```typescript
// In @FrontMcp({ authorities: { ... } })
authorities: {
  claimsResolver: (authInfo) => {
    const claims = authInfo?.extra?.authorization?.claims ?? {};
    const user = authInfo?.user ?? {};

    // Custom extraction logic
    const roles = (claims['x-custom-roles'] as string || '').split(',').filter(Boolean);
    const permissions = Array.isArray(claims['x-permissions'])
      ? claims['x-permissions']
      : [];

    return {
      roles,
      permissions,
      claims: { ...claims, ...user },
    };
  },
}
```

**When to use `claimsResolver`:**

- The token has roles encoded as a comma-separated string or bitmask
- Roles need to be derived from multiple claim fields
- Permissions require runtime transformation (e.g., wildcard expansion)
- The token structure is deeply nested or unconventional

`claimsResolver` takes precedence over `claimsMapping` when both are provided.

## Quick Reference Table

| IdP      | Roles Path                | Permissions Path                 | Tenant Path       | Notes                             |
| -------- | ------------------------- | -------------------------------- | ----------------- | --------------------------------- |
| Auth0    | `https://myapp.com/roles` | `permissions`                    | `org_id`          | Namespace is developer-defined    |
| Keycloak | `realm_access.roles`      | `resource_access.<client>.roles` | Custom claim      | Replace `<client>` with client ID |
| Okta     | `groups`                  | `scp`                            | Custom claim      | Groups must be added as a claim   |
| Cognito  | `cognito:groups`          | `scope`                          | `custom:tenantId` | `scope` is space-separated        |
| Frontegg | `roles`                   | `permissions`                    | `tenantId`        | Works with default fallback       |

## Reference

- Type: `AuthoritiesClaimsMapping` in `libs/auth/src/authorities/authorities.profiles.ts`
- Context builder: `AuthoritiesContextBuilder` in `libs/auth/src/authorities/authorities.context.ts`
- Related: `references/authority-profiles.md`, `references/rbac-abac-rebac.md`
