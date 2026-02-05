# @frontmcp/di

Dependency injection container and registry utilities for FrontMCP.

[![NPM](https://img.shields.io/npm/v/@frontmcp/di.svg)](https://www.npmjs.com/package/@frontmcp/di)

> **Internal package.** Used by `@frontmcp/sdk` — most users do not need to install this directly.

## Install

```bash
npm install @frontmcp/di reflect-metadata zod
```

## Features

- **Type-safe DI** — class tokens with configurable prefixes ([docs][docs-providers])
- **Scoped providers** — GLOBAL and CONTEXT scopes
- **Hierarchical registries** — parent/child container adoption
- **Indexed lookups** — O(1) registry queries via `IndexedRegistry`
- **Change events** — subscribe to registry mutations
- **Token factory** — `createTokenFactory({ prefix })` for Symbol-based tokens

## Quick Example

```ts
import 'reflect-metadata';
import { DiContainer, createTokenFactory, ProviderScope } from '@frontmcp/di';

const tokens = createTokenFactory({ prefix: 'MyApp' });

class DatabaseService {
  static metadata = { name: 'Database', scope: ProviderScope.GLOBAL };
}

const container = new DiContainer([DatabaseService]);
await container.ready;
const db = container.get(DatabaseService);
```

## Docs

| Topic          | Link                        |
| -------------- | --------------------------- |
| Providers & DI | [Providers][docs-providers] |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — consumes DI for server-level injection

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-providers]: https://docs.agentfront.dev/frontmcp/extensibility/providers
