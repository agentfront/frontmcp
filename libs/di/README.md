# @frontmcp/di

The dependency injection container behind FrontMCP. This is an internal package: `@frontmcp/sdk` uses it to build providers and registries, and installs it for you. In a FrontMCP server, declare shared services with `@Provider` and read them with `this.get()` from `@frontmcp/sdk` instead. The container has no FrontMCP-specific code, so you can also use it on its own in any TypeScript project.

[![npm](https://img.shields.io/npm/v/@frontmcp/di.svg)](https://www.npmjs.com/package/@frontmcp/di) [![License](https://img.shields.io/npm/l/@frontmcp/di.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/di @frontmcp/lazy-zod zod reflect-metadata
```

`@frontmcp/lazy-zod` (which needs `zod` 4) and `reflect-metadata` are peer dependencies. Import `reflect-metadata` once, before anything else. It needs Node.js 24 or later.

## Usage

```ts
import 'reflect-metadata';

import { createTokenFactory, DiContainer, ProviderScope } from '@frontmcp/di';

const tokens = createTokenFactory({ prefix: 'Desk' });
const DESK_URL = tokens.type('DeskUrl');

class TicketStore {
  static metadata = { name: 'TicketStore', scope: ProviderScope.GLOBAL };
  readonly tickets = new Map<string, string>();
}

class TicketClient {
  constructor(
    readonly store: TicketStore,
    readonly baseUrl: string,
  ) {}
}

const container = new DiContainer([
  TicketStore,
  { provide: DESK_URL, useValue: 'https://desk.example.com' },
  {
    provide: TicketClient,
    inject: () => [TicketStore, DESK_URL],
    useFactory: (store: TicketStore, baseUrl: string) => new TicketClient(store, baseUrl),
  },
]);

await container.ready;

const client = container.get(TicketClient);
```

### Providers

| Form                                        | How it's built                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MyClass`                                   | With `new`. An optional `static metadata = { name, scope }` names it and sets its scope. Constructor parameters are injected when TypeScript records their types, which it does for a decorated class with `emitDecoratorMetadata` on. |
| `@AsyncWith(() => [DepA, DepB])` on a class | By calling its static `with(depA, depB)`, which may be async.                                                                                                                                                                          |
| `{ provide, useValue }`                     | The value itself.                                                                                                                                                                                                                      |
| `{ provide, useFactory, inject }`           | By calling `useFactory` with the providers `inject()` returns, in order.                                                                                                                                                               |
| `{ provide, useClass }`                     | Like a class, registered under `provide`.                                                                                                                                                                                              |

`provide` is a class, a symbol or a string. `createTokenFactory({ prefix })` makes symbols with `Symbol.for()`, so two copies of a package in one process share them: `tokens.type('DeskUrl')` is `Symbol.for('Desk:type:DeskUrl')`.

### Scopes

- `ProviderScope.GLOBAL` (the default): one instance, built in dependency order when the container starts. `await container.ready`, then read it with `container.get(token)`, or `container.tryGet(token)`, which returns `undefined` instead of throwing.
- `ProviderScope.CONTEXT`: one instance per context, like a request or a session. Build a context with `const views = await container.buildViews(key)`, then read it with `container.getScoped(token, views)`.

A `GLOBAL` provider can't depend on a `CONTEXT` one, and the container throws on dependency cycles.

### Hierarchy and registries

`new DiContainer(providers, parent)` looks up tokens it doesn't have in `parent`. The package also exports the registry base classes FrontMCP's own registries extend: `RegistryAbstract`, `SimpleRegistry`, and `IndexedRegistry`, which indexes entries by ID, name and owner, adopts child registries, and emits change events to `subscribe()` callbacks.

## Docs

- [`@Provider`](https://frontmcp.dev/reference/sdk/provider): providers in a FrontMCP server, built on this container
- [Sharing state with providers](https://frontmcp.dev/learn/sharing-state-with-providers): a step-by-step guide

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework. Use its `@Provider` in a FrontMCP server.
- [`@frontmcp/lazy-zod`](https://www.npmjs.com/package/@frontmcp/lazy-zod): the Zod used for `providerMetadataSchema`.

## Contributing

Source: [`libs/di`](https://github.com/agentfront/frontmcp/tree/main/libs/di). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
