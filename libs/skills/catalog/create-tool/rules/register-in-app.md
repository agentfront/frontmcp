---
name: register-in-app
constraint: 'Register tools in `@App({ tools })`, not directly on `@FrontMcp({ tools })` (the latter is the simple-server escape hatch).'
severity: recommended
---

# Rule: register tools in `@App`

## The rule

Register tools in an `@App({ tools })`. `@FrontMcp({ tools })` is the escape hatch for single-app prototypes — promote to an `@App` as soon as you want any of the per-app benefits.

## Good

```typescript
@App({
  name: 'main',
  providers: [UserServiceProvider],
  tools: [GreetUserTool, GetUserTool],
})
class MainApp {}

@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  apps: [MainApp],
})
export default class DemoServer {}
```

## Acceptable (single-app prototypes)

```typescript
@FrontMcp({
  info: { name: 'demo', version: '1.0.0' },
  tools: [GreetUserTool], // top-level — fine for very small servers
})
export default class DemoServer {}
```

## Why prefer `@App`

| Top-level `@FrontMcp({ tools })`        | `@App({ tools })`                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One auth posture for the whole server   | Per-app `auth: { mode: 'public' \| 'transparent' \| 'local' \| 'remote' }`                      |
| Providers visible to every tool         | DI scope per app — tokens registered in `@App({ providers })` are visible only to its own tools |
| No per-app lifecycle                    | `onAppStart`, `onAppStop`, app-level hooks                                                      |
| Hard to refactor when you need to split | Already split                                                                                   |

## When to promote to `@App`

Whenever any of the following:

- You want different auth modes for different parts of the surface (public vs authenticated vs admin)
- Tools share local services that other apps shouldn't see
- You want per-app lifecycle hooks
- You're past ~5 tools in one server

Promoting from top-level to an `@App` is a one-line refactor:

```typescript
// before
@FrontMcp({ tools: [A, B, C] })

// after
@App({ name: 'main', tools: [A, B, C] }) class MainApp {}
@FrontMcp({ apps: [MainApp] })
```

## Severity

This rule is `recommended`, not `required`. Single-app prototypes can stay on top-level `@FrontMcp({ tools })` indefinitely. The push to `@App` is about future-proofing for the moment you need any per-app concern — which usually arrives.

## See also

- `architecture` skill — multi-app patterns, module boundaries, DI scope
- [`references/registration.md`](../references/registration.md)
