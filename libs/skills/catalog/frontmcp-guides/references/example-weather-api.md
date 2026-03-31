---
name: example-weather-api
description: Beginner MCP server with a weather lookup tool, static resource, Zod schemas, and E2E tests
---

# Example: Weather API (Beginner)

> Skills used: setup-project, create-tool, create-resource, setup-testing, deploy-to-node

A complete beginner MCP server that exposes a weather lookup tool and a static resource listing supported cities. Demonstrates server setup, Zod input/output schemas, `this.fetch()` for HTTP calls, `this.fail()` for error handling, and both unit and E2E tests.

---

## Project Setup

```jsonc
// package.json
{
  "name": "weather-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "frontmcp build",
    "start": "frontmcp start",
    "test": "jest --coverage",
  },
  "dependencies": {
    "@frontmcp/sdk": "^1.0.0",
    "zod": "^3.23.0",
  },
  "devDependencies": {
    "@frontmcp/testing": "^1.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.4.0",
  },
}
```

---

## Server Entry Point

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

---

## App Registration

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

---

## Tool: Get Weather

```typescript
// src/tools/get-weather.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: {
    city: z.string().min(1).describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature units'),
  },
  outputSchema: {
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    city: z.string(),
  },
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string; units: 'celsius' | 'fahrenheit' }) {
    const url = `https://api.weather.example.com/v1/current?city=${encodeURIComponent(input.city)}&units=${input.units}`;

    // No try/catch needed — the framework's tool execution flow handles errors automatically.
    // Use this.fail() only for business-logic errors (e.g., invalid response).
    const response = await this.fetch(url);

    if (!response.ok) {
      this.fail(new Error(`Weather API error: ${response.status} ${response.statusText}`));
    }

    const data = await response.json();

    return {
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
      city: input.city,
    };
  }
}
```

---

## Resource: Supported Cities

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

---

## Unit Test: GetWeatherTool

```typescript
// test/get-weather.tool.spec.ts
import { ToolContext } from '@frontmcp/sdk';
import { GetWeatherTool } from '../src/tools/get-weather.tool';

describe('GetWeatherTool', () => {
  let tool: GetWeatherTool;

  beforeEach(() => {
    tool = new GetWeatherTool();
  });

  it('should return weather data for a valid city', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        temp: 22,
        condition: 'Sunny',
        humidity: 45,
      }),
    } as unknown as Response;

    const ctx = {
      fetch: jest.fn().mockResolvedValue(mockResponse),
      fail: jest.fn((err: Error) => {
        throw err;
      }),
      mark: jest.fn(),
      get: jest.fn(),
      tryGet: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as ToolContext;
    Object.assign(tool, ctx);

    const result = await tool.execute({ city: 'London', units: 'celsius' });

    expect(result).toEqual({
      temperature: 22,
      condition: 'Sunny',
      humidity: 45,
      city: 'London',
    });
    expect(ctx.fetch).toHaveBeenCalledWith(expect.stringContaining('city=London'));
  });

  it('should fail when city is empty (Zod validation)', () => {
    const { z } = require('zod');
    const schema = z.object({
      city: z.string().min(1),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    });

    expect(() => schema.parse({ city: '' })).toThrow();
  });

  it('should fail when the weather API returns an error', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response;

    const failFn = jest.fn((err: Error) => {
      throw err;
    });
    const ctx = {
      fetch: jest.fn().mockResolvedValue(mockResponse),
      fail: failFn,
      mark: jest.fn(),
      get: jest.fn(),
      tryGet: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as ToolContext;
    Object.assign(tool, ctx);

    await expect(tool.execute({ city: 'Atlantis', units: 'celsius' })).rejects.toThrow(
      'Weather API error: 404 Not Found',
    );

    expect(failFn).toHaveBeenCalled();
  });
});
```

---

## E2E Test: Weather Server

```typescript
// test/weather.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';
import Server from '../src/main';

describe('Weather Server E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({ command: 'npx tsx src/main.ts' });
    client = await McpTestClient.create({ baseUrl: server.info.baseUrl }).buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('should list tools including get_weather', async () => {
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toContainTool('get_weather');
  });

  it('should call get_weather with a valid city', async () => {
    const result = await client.callTool('get_weather', {
      city: 'London',
      units: 'celsius',
    });

    expect(result).toBeSuccessful();
    expect(result.content[0].text).toBeDefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('temperature');
    expect(parsed).toHaveProperty('condition');
    expect(parsed).toHaveProperty('humidity');
    expect(parsed).toHaveProperty('city', 'London');
  });

  it('should read the cities resource', async () => {
    const { resources } = await client.listResources();
    const citiesResource = resources.find((r) => r.uri === 'weather://cities');
    expect(citiesResource).toBeDefined();

    const result = await client.readResource('weather://cities');
    const cities = JSON.parse(result.contents[0].text);

    expect(Array.isArray(cities)).toBe(true);
    expect(cities).toContain('London');
    expect(cities).toContain('Tokyo');
  });
});
```

## Examples

| Example                                                                                     | Level        | Description                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`server-and-app-setup`](../examples/example-weather-api/server-and-app-setup.md)           | Basic        | Shows the server entry point, app registration, and static resource for a beginner FrontMCP weather API server.                        |
| [`unit-and-e2e-tests`](../examples/example-weather-api/unit-and-e2e-tests.md)               | Intermediate | Shows how to write unit tests for tools by mocking context methods, and E2E tests using `McpTestClient` and `TestServer`.              |
| [`weather-tool-with-schemas`](../examples/example-weather-api/weather-tool-with-schemas.md) | Basic        | Shows how to create a tool with Zod input and output schemas, use `this.fetch()` for HTTP calls, and handle errors with `this.fail()`. |

> See all examples in [`examples/example-weather-api/`](../examples/example-weather-api/)
