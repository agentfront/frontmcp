---
name: unit-and-e2e-tests
reference: example-weather-api
level: intermediate
description: 'Shows how to write unit tests for tools by mocking context methods, and E2E tests using `McpTestClient` and `TestServer`.'
tags: [guides, e2e, unit-test, weather, api, unit]
features:
  - 'Unit testing tools by mocking `this.fetch()`, `this.fail()`, and other context methods'
  - 'Using `Object.assign(tool, ctx)` to inject mock context into the tool instance'
  - 'E2E testing with `TestServer.start()` and `McpTestClient.create()`'
  - 'Using `toContainTool()` custom matcher for asserting tool presence'
  - 'Proper cleanup with `client.disconnect()` and `server.stop()` in `afterAll`'
---

# Weather API: Unit and E2E Tests

Shows how to write unit tests for tools by mocking context methods, and E2E tests using `McpTestClient` and `TestServer`.

## Code

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

```typescript
// test/weather.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';

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

  it('should read the cities resource', async () => {
    const result = await client.readResource('weather://cities');
    const cities = JSON.parse(result.contents[0].text);

    expect(Array.isArray(cities)).toBe(true);
    expect(cities).toContain('London');
    expect(cities).toContain('Tokyo');
  });
});
```

## What This Demonstrates

- Unit testing tools by mocking `this.fetch()`, `this.fail()`, and other context methods
- Using `Object.assign(tool, ctx)` to inject mock context into the tool instance
- E2E testing with `TestServer.start()` and `McpTestClient.create()`
- Using `toContainTool()` custom matcher for asserting tool presence
- Proper cleanup with `client.disconnect()` and `server.stop()` in `afterAll`

## Related

- See `example-weather-api` for the full end-to-end weather API example
