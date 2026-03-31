---
name: server-and-app-setup
reference: example-weather-api
level: basic
description: 'Shows the server entry point, app registration, and static resource for a beginner FrontMCP weather API server.'
tags: [guides, weather, api, app, setup]
features:
  - 'Server entry point with `@FrontMcp` decorator and `info` configuration'
  - 'App registration with `@App` grouping tools and resources together'
  - 'Static resource that returns JSON data via `read()`'
  - 'Clean separation between server, app, tools, and resources'
---

# Weather API: Server and App Setup

Shows the server entry point, app registration, and static resource for a beginner FrontMCP weather API server.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { WeatherApp } from './weather.app';

@FrontMcp({
  info: { name: 'weather-api', version: '1.0.0' },
  apps: [WeatherApp],
})
export default class WeatherServer {}
```

```typescript
// src/weather.app.ts
import { App } from '@frontmcp/sdk';
import { GetWeatherTool } from './tools/get-weather.tool';
import { CitiesResource } from './resources/cities.resource';

@App({
  name: 'Weather',
  description: 'Weather lookup tools and city data',
  tools: [GetWeatherTool],
  resources: [CitiesResource],
})
export class WeatherApp {}
```

```typescript
// src/resources/cities.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';

const SUPPORTED_CITIES = ['London', 'Tokyo', 'New York', 'Paris', 'Sydney', 'Berlin', 'Toronto', 'Mumbai'];

@Resource({
  uri: 'weather://cities',
  name: 'Supported Cities',
  description: 'List of cities with available weather data',
  mimeType: 'application/json',
})
export class CitiesResource extends ResourceContext {
  async read() {
    return JSON.stringify(SUPPORTED_CITIES);
  }
}
```

## What This Demonstrates

- Server entry point with `@FrontMcp` decorator and `info` configuration
- App registration with `@App` grouping tools and resources together
- Static resource that returns JSON data via `read()`
- Clean separation between server, app, tools, and resources

## Related

- See `example-weather-api` for the full end-to-end weather API example
