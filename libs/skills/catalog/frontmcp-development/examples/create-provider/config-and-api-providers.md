---
name: config-and-api-providers
reference: create-provider
level: intermediate
description: 'A configuration provider with readonly environment settings and an HTTP API client provider.'
tags: [development, provider, config, api, providers]
features:
  - 'A configuration provider using `readonly` properties from environment variables (sync construction)'
  - 'An API client provider that reads credentials in the constructor (no `onInit` — `@Provider` has no lifecycle hooks)'
  - 'Registering providers at `@FrontMcp` level for server-wide sharing across all apps'
  - 'Separating token definitions from provider implementations for clean dependency boundaries'
---

# Configuration and API Client Providers

A configuration provider with readonly environment settings and an HTTP API client provider.

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
// src/apps/main/providers/config.provider.ts
import { Provider } from '@frontmcp/sdk';

import type { AppConfig } from '../tokens';

@Provider({ name: 'ConfigProvider' })
class ConfigProvider implements AppConfig {
  readonly apiBaseUrl = process.env.API_BASE_URL ?? 'https://api.example.com';
  readonly maxRetries = Number(process.env.MAX_RETRIES ?? 3);
  readonly debug = process.env.DEBUG === 'true';
}
```

```typescript
// src/apps/main/providers/api-client.provider.ts
import { Provider } from '@frontmcp/sdk';

import type { ApiClient } from '../tokens';

@Provider({ name: 'ApiClientProvider' })
class ApiClientProvider implements ApiClient {
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
// src/index.ts
import { FrontMcp } from '@frontmcp/sdk';

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
- Registering providers at `@FrontMcp` level for server-wide sharing across all apps
- Separating token definitions from provider implementations for clean dependency boundaries

## Related

- See `create-provider` for cache providers, lifecycle details, and the `tryGet()` safe access pattern
