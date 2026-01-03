# @frontmcp/di

Generic dependency injection container and registry utilities for TypeScript applications.

## Features

- Type-safe dependency injection with class tokens
- Configurable token factory with custom prefixes
- Hierarchical provider registries
- Scoped providers (GLOBAL, CONTEXT)
- Indexed registry base class with O(1) lookups
- Adoption pattern for child registries
- Change event subscriptions

## Installation

```bash
npm install @frontmcp/di reflect-metadata zod
```

## Usage

```typescript
import 'reflect-metadata';
import { DiContainer, createTokenFactory, ProviderScope } from '@frontmcp/di';

// Create a token factory with custom prefix
const tokenFactory = createTokenFactory({ prefix: 'MyApp' });

// Define providers
class DatabaseService {
  static metadata = { name: 'Database', scope: ProviderScope.GLOBAL };
}

// Create container
const container = new DiContainer([DatabaseService]);
await container.ready;

// Resolve dependencies
const db = container.get(DatabaseService);
```

## API

### Token Factory

```typescript
import { createTokenFactory } from '@frontmcp/di';

const tokens = createTokenFactory({ prefix: 'MyApp' });
const myToken = tokens.type('MyService'); // Symbol('MyApp:type:MyService')
```

### Provider Normalizer

```typescript
import { createProviderNormalizer } from '@frontmcp/di';

const normalizeProvider = createProviderNormalizer({
  type: Symbol('type'),
  name: Symbol('name'),
  scope: Symbol('scope'),
});
```

### DiContainer

```typescript
import { DiContainer } from '@frontmcp/di';

const container = new DiContainer(providers, parentContainer);
await container.ready;

container.get(Token); // Get GLOBAL provider
container.resolve(Class); // Resolve or construct
container.buildViews(key); // Build scoped views
```

### IndexedRegistry

Base class for registries with fast lookups:

```typescript
import { IndexedRegistry } from '@frontmcp/di';

class MyRegistry extends IndexedRegistry<MyInstance, MyRecord, MyIndexed, MyMetadata> {
  protected buildIndexes(rows: MyIndexed[]): void {
    // Build custom indexes
  }
}
```

## License

Apache-2.0
