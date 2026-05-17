---
name: config-and-api-providers
reference: create-provider
level: intermediate
description: 'A configuration provider and an HTTP API client provider, organized as one folder per provider with co-located specs and barrels.'
tags: [development, provider, config, api, providers]
features:
  - 'A configuration provider using `readonly` properties from environment variables (sync construction)'
  - 'An API client provider that reads credentials in the constructor (no `onInit` — `@Provider` has no lifecycle hooks)'
  - 'Folder-per-provider layout (`src/apps/main/providers/<slug>/`) with a barrel `index.ts` and a co-located `.provider.spec.ts`'
  - 'Top-level `src/apps/main/providers/index.ts` barrel re-exporting each provider folder'
  - 'Registering providers at `@FrontMcp` level for server-wide sharing across all apps'
  - 'Separating token definitions from provider implementations for clean dependency boundaries'
---

# Configuration and API Client Providers

A configuration provider and an HTTP API client provider, organized as one folder per provider with co-located specs and barrels.

## File layout

```text
src/apps/main/
├── tokens.ts                                # shared token + interface definitions
├── index.ts                                 # @App / @FrontMcp registration
└── providers/
    ├── index.ts                             # top-level barrel
    ├── config/
    │   ├── index.ts                         # barrel: ConfigProvider
    │   ├── config.provider.ts               # @Provider class
    │   └── config.provider.spec.ts          # tests
    └── api-client/
        ├── index.ts                         # barrel: ApiClientProvider
        ├── api-client.provider.ts           # @Provider class
        └── api-client.provider.spec.ts      # tests
```

Each provider lives in its own subfolder with a barrel — cross-provider imports go through the barrel (`from '../config'`), never reaching into another provider's implementation file.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface AppConfig {
  apiBaseUrl: string;
  maxRetries: number;
  debug: boolean;
}

export const CONFIG_TOKEN: Token<AppConfig> = Symbol('AppConfig');

export interface ApiClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export const API_TOKEN: Token<ApiClient> = Symbol('ApiClient');
```

```typescript
// src/apps/main/providers/config/config.provider.ts
import { Provider } from '@frontmcp/sdk';

import type { AppConfig } from '../../tokens';

@Provider({ name: 'ConfigProvider' })
export class ConfigProvider implements AppConfig {
  readonly apiBaseUrl = process.env.API_BASE_URL ?? 'https://api.example.com';
  readonly maxRetries = Number(process.env.MAX_RETRIES ?? 3);
  readonly debug = process.env.DEBUG === 'true';
}
```

```typescript
// src/apps/main/providers/config/index.ts
export { ConfigProvider } from './config.provider';
```

```typescript
// src/apps/main/providers/config/config.provider.spec.ts
import { ConfigProvider } from './config.provider';

describe('ConfigProvider', () => {
  it('reads apiBaseUrl from env with a default fallback', () => {
    const provider = new ConfigProvider();
    expect(provider.apiBaseUrl).toBeDefined();
    expect(typeof provider.apiBaseUrl).toBe('string');
  });
});
```

```typescript
// src/apps/main/providers/api-client/api-client.provider.ts
import { Provider } from '@frontmcp/sdk';

import type { ApiClient } from '../../tokens';

@Provider({ name: 'ApiClientProvider' })
export class ApiClientProvider implements ApiClient {
  // `@Provider` has no `onInit` lifecycle hook — read env in the constructor.
  // First instantiation throws synchronously on missing config (fail fast).
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const baseUrl = process.env.API_URL;
    const apiKey = process.env.API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error('ApiClientProvider: API_URL and API_KEY must be set');
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return res.json();
  }

  async post(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }
}
```

```typescript
// src/apps/main/providers/api-client/index.ts
export { ApiClientProvider } from './api-client.provider';
```

```typescript
// src/apps/main/providers/api-client/api-client.provider.spec.ts
import { ApiClientProvider } from './api-client.provider';

describe('ApiClientProvider', () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('throws fast when API_URL or API_KEY is missing', () => {
    delete process.env.API_URL;
    delete process.env.API_KEY;
    expect(() => new ApiClientProvider()).toThrow(/API_URL and API_KEY/);
  });
});
```

```typescript
// src/apps/main/providers/index.ts
// Top-level barrel — re-exports each provider folder so importers can do
// `import { ConfigProvider, ApiClientProvider } from './providers'`.
export * from './config';
export * from './api-client';
```

```typescript
// src/index.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './apps/main';
import { ApiClientProvider, ConfigProvider } from './apps/main/providers';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MainApp],
  providers: [ConfigProvider, ApiClientProvider], // Server-scoped: shared across all apps
})
class MyServer {}
```

## What This Demonstrates

- A configuration provider using `readonly` properties from environment variables (sync construction)
- An API client provider that reads credentials in the constructor (no `onInit` — `@Provider` has no lifecycle hooks)
- Folder-per-provider layout (`src/apps/main/providers/<slug>/`) with a barrel `index.ts` and a co-located `.provider.spec.ts`
- Top-level `src/apps/main/providers/index.ts` barrel re-exporting each provider folder
- Registering providers at `@FrontMcp` level for server-wide sharing across all apps
- Separating token definitions from provider implementations for clean dependency boundaries

## Related

- See `create-provider` for the [File Layout](../../references/create-provider.md#file-layout) section, cache providers, lifecycle details, and the `tryGet()` safe access pattern
