---
name: cache-and-feature-flags
reference: official-plugins
level: intermediate
description: 'Demonstrates combining the Cache plugin for tool result caching with the Feature Flags plugin for gating tools behind flags.'
tags: [development, feature-flags, cache, plugins, feature, flags]
features:
  - 'Combining `CachePlugin` and `FeatureFlagPlugin` in the same server'
  - 'Using `toolPatterns` glob patterns to cache groups of tools without per-tool configuration'
  - 'Per-tool `cache` metadata with custom `ttl` (seconds) and `slideWindow` for TTL refresh on hits'
  - 'Using `cache: true` for simple default-TTL caching'
  - "Gating a tool with `featureFlag: 'beta-search'` -- the tool is hidden from `list_tools` when the flag is off"
  - 'Accessing `this.featureFlags.isEnabled()` inside a tool for runtime flag checks'
---

# Cache Plugin and Feature Flags Plugin

Demonstrates combining the Cache plugin for tool result caching with the Feature Flags plugin for gating tools behind flags.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import CachePlugin from '@frontmcp/plugin-cache';
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';

@App({
  name: 'api',
  tools: [GetWeatherTool, GetUserProfileTool, BetaSearchTool],
})
class ApiApp {}

@FrontMcp({
  info: { name: 'cached-flagged-server', version: '1.0.0' },
  apps: [ApiApp],
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 3600,
      toolPatterns: ['api:get-*', 'search:*'],
      bypassHeader: 'x-frontmcp-disable-cache',
    }),
    FeatureFlagPlugin.init({
      adapter: 'static',
      flags: {
        'beta-search': true,
        'experimental-agent': false,
      },
    }),
  ],
})
class MyServer {}
```

```typescript
// src/tools/get-weather.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

// Per-tool cache metadata with custom TTL and sliding window
@Tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: {
    city: z.string().describe('City name'),
  },
  cache: {
    ttl: 1800,
    slideWindow: true,
  },
})
class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    const weather = await this.get(WeatherService).getCurrent(input.city);
    return { city: input.city, temperature: weather.temp, condition: weather.condition };
  }
}
```

```typescript
// src/tools/beta-search.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

// Tool gated behind a feature flag -- hidden from list_tools when flag is off
@Tool({
  name: 'beta_search',
  description: 'New search algorithm (beta)',
  inputSchema: {
    query: z.string(),
  },
  featureFlag: 'beta-search',
  cache: true,
})
class BetaSearchTool extends ToolContext {
  async execute(input: { query: string }) {
    const enabled = await this.featureFlags.isEnabled('beta-search');
    const results = await this.get(SearchService).search(input.query);
    return { results, algorithm: 'v2-beta' };
  }
}
```

## What This Demonstrates

- Combining `CachePlugin` and `FeatureFlagPlugin` in the same server
- Using `toolPatterns` glob patterns to cache groups of tools without per-tool configuration
- Per-tool `cache` metadata with custom `ttl` (seconds) and `slideWindow` for TTL refresh on hits
- Using `cache: true` for simple default-TTL caching
- Gating a tool with `featureFlag: 'beta-search'` -- the tool is hidden from `list_tools` when the flag is off
- Accessing `this.featureFlags.isEnabled()` inside a tool for runtime flag checks

## Related

- See `official-plugins` for all plugin configuration options, Redis cache, and external flag adapters
- See `create-tool-annotations` for additional tool metadata like `readOnlyHint` and `destructiveHint`
