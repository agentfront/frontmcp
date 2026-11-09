import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3007';

describe('McpTestClient protocol version', () => {
  it('accepts 2026-07-28', () => {
    expect(() => McpTestClient.create({ baseUrl: BASE_URL }).withProtocolVersion('2026-07-28').build()).not.toThrow();
  });

  it('accepts an earlier revision', () => {
    expect(() => McpTestClient.create({ baseUrl: BASE_URL }).withProtocolVersion('2025-03-26').build()).not.toThrow();
  });
});
