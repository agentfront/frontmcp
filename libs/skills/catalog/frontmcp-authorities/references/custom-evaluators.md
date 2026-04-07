---
name: custom-evaluators
description: Creating and registering custom authority evaluators for domain-specific authorization logic beyond RBAC, ABAC, and ReBAC
---

# Custom Evaluators

When the built-in RBAC, ABAC, and ReBAC models do not cover your authorization requirements, you can create custom evaluators. Custom evaluators are registered via the `authorities.evaluators` config in `@FrontMcp()` and invoked via the `custom.*` field in policies.

## AuthoritiesEvaluator Interface

Every custom evaluator must implement the `AuthoritiesEvaluator` interface from `@frontmcp/auth`.

```typescript
import type { AuthoritiesEvaluator, AuthoritiesEvaluationContext, AuthoritiesResult } from '@frontmcp/auth';

interface AuthoritiesEvaluator {
  /** Evaluator name (must match the key under `custom.*` in policies) */
  name: string;
  /** Evaluate the policy against the context */
  evaluate(
    policy: unknown,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult>;
}
```

The `policy` parameter is whatever value is passed under the evaluator's key in the `custom` field. The `ctx` parameter provides the full evaluation context including user info, input, environment, and the relationship resolver.

The return value must be an `AuthoritiesResult`:

```typescript
interface AuthoritiesResult {
  /** Whether access was granted */
  granted: boolean;
  /** Human-readable reason for denial */
  deniedBy?: string;
  /** List of policy types that were evaluated (for audit) */
  evaluatedPolicies: string[];
  /** Optional detailed message */
  message?: string;
}
```

## Registering Custom Evaluators

Custom evaluators are registered in the `evaluators` field of the `authorities` config. The key must match the evaluator's `name` and the key used in `custom.*` policies.

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import { ipAllowListEvaluator } from './evaluators/ip-allow-list';
import { featureFlagEvaluator } from './evaluators/feature-flag';
import { timeWindowEvaluator } from './evaluators/time-window';

@FrontMcp({
  name: 'my-server',
  authorities: {
    claimsMapping: { roles: 'roles', permissions: 'permissions' },
    profiles: { admin: { roles: { any: ['admin'] } } },
    evaluators: {
      ipAllowList: ipAllowListEvaluator,
      featureFlag: featureFlagEvaluator,
      timeWindow: timeWindowEvaluator,
    },
  },
})
export class MyServer {}
```

## Async Guards: DB/Redis Lookups

Custom evaluators are **fully async** — use them for database queries, Redis checks, feature flags, or any I/O-bound authorization logic.

### Redis Set Membership

```typescript
const tenantAllowlistGuard: AuthoritiesEvaluator = {
  name: 'tenantAllowlist',
  evaluate: async (policy, ctx) => {
    const { redisKey } = policy as { redisKey: string };
    const tenantId = ctx.input['tenantId'] as string;
    const isAllowed = await redis.sismember(redisKey, tenantId);
    return {
      granted: isAllowed,
      deniedBy: isAllowed ? undefined : `tenant '${tenantId}' not in allowlist`,
      denial: isAllowed ? undefined : { kind: 'custom', path: 'custom.tenantAllowlist' },
      evaluatedPolicies: ['custom.tenantAllowlist'],
    };
  },
};
```

### Database Query

```typescript
const activeSubscriptionGuard: AuthoritiesEvaluator = {
  name: 'activeSubscription',
  evaluate: async (_policy, ctx) => {
    const row = await db.query('SELECT active FROM subscriptions WHERE user_id = $1', [ctx.user.sub]);
    const active = row?.active === true;
    return {
      granted: active,
      deniedBy: active ? undefined : 'no active subscription',
      denial: active ? undefined : { kind: 'custom', path: 'custom.activeSubscription' },
      evaluatedPolicies: ['custom.activeSubscription'],
    };
  },
};
```

### Feature Flag

```typescript
const featureFlagGuard: AuthoritiesEvaluator = {
  name: 'featureFlag',
  evaluate: async (policy, ctx) => {
    const { flag } = policy as { flag: string };
    const enabled = await featureFlagService.isEnabled(flag, { userId: ctx.user.sub });
    return {
      granted: enabled,
      deniedBy: enabled ? undefined : `feature '${flag}' not enabled`,
      denial: enabled ? undefined : { kind: 'custom', path: `custom.featureFlag.${flag}` },
      evaluatedPolicies: [`custom.featureFlag`],
    };
  },
};
```

### When to Use Custom Evaluators vs Hooks

| Approach | When to Use |
| -------- | ----------- |
| **Custom evaluator** | Reusable async check across many tools — register once, reference via `custom` field |
| **`Will('checkEntryAuthorities')` hook** | One-off async check for a specific plugin/app, not tied to a specific tool |
| **Static `authorities` policy** | Roles, permissions, attributes — no I/O needed |

## Using Custom Evaluators in Policies

Reference custom evaluators via the `custom` field on any `AuthoritiesPolicyMetadata`. The key under `custom` must match the registered evaluator name.

```typescript
@Tool({
  name: 'admin_panel',
  authorities: {
    roles: { any: ['admin'] },
    custom: {
      ipAllowList: { cidr: ['10.0.0.0/8', '172.16.0.0/12'] },
    },
  },
})
export default class AdminPanelTool extends ToolContext { ... }
```

The engine evaluates `custom` evaluators alongside RBAC, ABAC, and ReBAC. They follow the same `operator` semantics (default `'AND'`), so in the example above the user must have the `admin` role AND pass the IP allowlist check.

## Example: IP Allowlist Evaluator

Restricts access to requests from specific CIDR ranges.

```typescript
// evaluators/ip-allow-list.ts
import type { AuthoritiesEvaluator, AuthoritiesEvaluationContext, AuthoritiesResult } from '@frontmcp/auth';

interface IpAllowListPolicy {
  cidr: string[];
}

function isInCidr(ip: string, cidr: string): boolean {
  // Simplified -- use a library like 'ip-cidr' in production
  const [subnet, bits] = cidr.split('/');
  if (!bits) return ip === subnet;
  // ... full CIDR matching logic
  return false;
}

export const ipAllowListEvaluator: AuthoritiesEvaluator = {
  name: 'ipAllowList',
  async evaluate(
    policy: unknown,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const { cidr } = policy as IpAllowListPolicy;
    const remoteIp = ctx.env['remoteIp'] as string | undefined;

    if (!remoteIp) {
      return {
        granted: false,
        deniedBy: 'custom.ipAllowList: remoteIp not available in env',
        evaluatedPolicies: ['custom.ipAllowList'],
      };
    }

    const allowed = cidr.some((c) => isInCidr(remoteIp, c));

    return {
      granted: allowed,
      deniedBy: allowed ? undefined : `custom.ipAllowList: ${remoteIp} not in allowed CIDR ranges`,
      evaluatedPolicies: ['custom.ipAllowList'],
    };
  },
};
```

**Usage:**

```typescript
@Tool({
  name: 'internal_admin',
  authorities: {
    custom: {
      ipAllowList: { cidr: ['10.0.0.0/8', '192.168.0.0/16'] },
    },
  },
})
export default class InternalAdminTool extends ToolContext { ... }
```

## Example: Feature Flag Evaluator

Gates access behind a feature flag service.

```typescript
// evaluators/feature-flag.ts
import type { AuthoritiesEvaluator, AuthoritiesEvaluationContext, AuthoritiesResult } from '@frontmcp/auth';

interface FeatureFlagPolicy {
  flag: string;
  /** If true, the flag must be disabled for access (inverse gate) */
  inverse?: boolean;
}

// Assume a global feature flag client is available
declare const featureFlags: { isEnabled(flag: string, userId: string): Promise<boolean> };

export const featureFlagEvaluator: AuthoritiesEvaluator = {
  name: 'featureFlag',
  async evaluate(
    policy: unknown,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const { flag, inverse } = policy as FeatureFlagPolicy;
    const enabled = await featureFlags.isEnabled(flag, ctx.user.sub);
    const granted = inverse ? !enabled : enabled;

    return {
      granted,
      deniedBy: granted ? undefined : `custom.featureFlag: '${flag}' is ${enabled ? 'enabled' : 'disabled'} (inverse=${!!inverse})`,
      evaluatedPolicies: ['custom.featureFlag'],
    };
  },
};
```

**Usage:**

```typescript
@Tool({
  name: 'beta_feature',
  authorities: {
    custom: {
      featureFlag: { flag: 'beta-tools-v2' },
    },
  },
})
export default class BetaFeatureTool extends ToolContext { ... }
```

## Example: Time Window Evaluator

Restricts access to specific time windows (e.g., business hours only).

```typescript
// evaluators/time-window.ts
import type { AuthoritiesEvaluator, AuthoritiesEvaluationContext, AuthoritiesResult } from '@frontmcp/auth';

interface TimeWindowPolicy {
  /** Allowed days (0=Sunday, 6=Saturday) */
  days: number[];
  /** Start hour (0-23, inclusive) */
  startHour: number;
  /** End hour (0-23, exclusive) */
  endHour: number;
  /** IANA timezone (default: UTC) */
  timezone?: string;
}

export const timeWindowEvaluator: AuthoritiesEvaluator = {
  name: 'timeWindow',
  async evaluate(
    policy: unknown,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const { days, startHour, endHour, timezone } = policy as TimeWindowPolicy;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? 'UTC',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const dayIndex = now.getDay(); // 0=Sun in the configured timezone context

    const dayAllowed = days.includes(dayIndex);
    const hourAllowed = hour >= startHour && hour < endHour;
    const granted = dayAllowed && hourAllowed;

    return {
      granted,
      deniedBy: granted ? undefined : `custom.timeWindow: current time outside allowed window`,
      evaluatedPolicies: ['custom.timeWindow'],
    };
  },
};
```

**Usage:**

```typescript
@Tool({
  name: 'payroll_sync',
  authorities: {
    roles: { any: ['finance'] },
    custom: {
      timeWindow: {
        days: [1, 2, 3, 4, 5],  // Monday through Friday
        startHour: 9,
        endHour: 17,
        timezone: 'America/New_York',
      },
    },
  },
})
export default class PayrollSyncTool extends ToolContext { ... }
```

## Example: Rate Limit Evaluator

Denies access when a per-user rate limit is exceeded.

```typescript
// evaluators/rate-limit.ts
import type { AuthoritiesEvaluator, AuthoritiesEvaluationContext, AuthoritiesResult } from '@frontmcp/auth';

interface RateLimitPolicy {
  /** Maximum calls allowed */
  max: number;
  /** Time window in seconds */
  windowSeconds: number;
}

// In-memory counter (use Redis in production)
const counters = new Map<string, { count: number; resetAt: number }>();

export const rateLimitEvaluator: AuthoritiesEvaluator = {
  name: 'rateLimit',
  async evaluate(
    policy: unknown,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const { max, windowSeconds } = policy as RateLimitPolicy;
    const key = `${ctx.user.sub}`;
    const now = Date.now();

    let entry = counters.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowSeconds * 1000 };
      counters.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      return {
        granted: false,
        deniedBy: `custom.rateLimit: ${entry.count}/${max} calls in window`,
        evaluatedPolicies: ['custom.rateLimit'],
      };
    }

    return {
      granted: true,
      evaluatedPolicies: ['custom.rateLimit'],
    };
  },
};
```

## Combining Custom Evaluators with Built-in Models

Custom evaluators participate in the same combinator system as RBAC, ABAC, and ReBAC.

```typescript
// Admin from allowed IP during business hours
authorities: {
  allOf: [
    { roles: { any: ['admin'] } },
    { custom: { ipAllowList: { cidr: ['10.0.0.0/8'] } } },
    { custom: { timeWindow: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 } } },
  ],
}

// Feature flag OR admin bypass
authorities: {
  anyOf: [
    { roles: { any: ['admin'] } },
    { custom: { featureFlag: { flag: 'new-dashboard' } } },
  ],
}
```

## Best Practices

| Practice | Description |
| --- | --- |
| Always return `evaluatedPolicies` | Include `custom.<name>` in the array for audit trail |
| Provide descriptive `deniedBy` | Include the evaluator name, the failing condition, and relevant values |
| Keep evaluators stateless when possible | Use external stores (Redis, database) for state; avoid in-memory maps in production |
| Type the policy parameter | Cast `policy as YourPolicyType` at the top of `evaluate()` |
| Handle missing context gracefully | Return denial with a clear message if expected env/input values are absent |
| Test evaluators in isolation | Each evaluator is a plain object; test `evaluate()` directly with mock contexts |
| Name evaluators with camelCase | The name must match both the registered key and the `custom.*` policy key |

## Reference

- Type: `AuthoritiesEvaluator` in `libs/auth/src/authorities/authorities.types.ts`
- Registry: `AuthoritiesEvaluatorRegistry` in `libs/auth/src/authorities/authorities.registry.ts`
- Engine dispatch: `evaluateCustom()` in `libs/auth/src/authorities/authorities.engine.ts`
- Related: `references/authority-profiles.md`, `references/rbac-abac-rebac.md`
