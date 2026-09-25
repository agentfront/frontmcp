import { McpTestClient } from '../mcp-test-client';

const BASE_URL = 'http://localhost:3007';

describe('McpTestClient protocol version', () => {
  it('rejects 2026-07-28, which has no initialize handshake', () => {
    expect(() => McpTestClient.create({ baseUrl: BASE_URL }).withProtocolVersion('2026-07-28').build()).toThrow(
      /does not support protocol version 2026-07-28/,
    );
  });

  it('accepts an earlier revision', () => {
    expect(() => McpTestClient.create({ baseUrl: BASE_URL }).withProtocolVersion('2025-03-26').build()).not.toThrow();
  });
});
