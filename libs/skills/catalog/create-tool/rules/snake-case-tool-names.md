---
name: snake-case-tool-names
constraint: 'Tool `name:` field is always `snake_case` (e.g. `get_weather`, not `getWeather`).'
severity: required
---

# Rule: tool names are `snake_case`

## The rule

The `name:` field on `@Tool({...})` is `snake_case`. Lowercase letters, digits, underscores. No camelCase, no kebab-case, no PascalCase.

## Good

```typescript
@Tool({ name: 'get_weather' })
@Tool({ name: 'create_issue' })
@Tool({ name: 'list_repos' })
@Tool({ name: 'send_email' })
@Tool({ name: 'rotate_secrets' })
```

## Bad

```typescript
@Tool({ name: 'getWeather' })    // ❌ camelCase
@Tool({ name: 'get-weather' })   // ❌ kebab-case
@Tool({ name: 'GetWeather' })    // ❌ PascalCase
@Tool({ name: 'GET_WEATHER' })   // ❌ uppercase
```

## Why

- **MCP protocol convention.** Tool names are the lookup key for `tools/call` across the entire MCP ecosystem. Servers and clients consistently expect `snake_case`.
- **Cross-platform consistency.** Some clients (and LLM prompt templates) normalize tool names for display; `snake_case` survives roundtrips. Mixed-case can be folded inconsistently.
- **Searchable.** `git grep create_issue` finds every reference; `git grep create.issue` (regex required for cross-case) is more work.

> The CLASS name stays `PascalCase` (`GetWeatherTool`). Only the `name:` _field_ is `snake_case`. The mismatch is intentional — class names follow TypeScript conventions, MCP tool names follow MCP conventions.

## Verification

```bash
# Find non-snake_case tool names — should return 0 hits
grep -rE "name:\s*'[^']*[A-Z-][^']*'" $(grep -rl '@Tool' src/**/*.tool.ts)
```
