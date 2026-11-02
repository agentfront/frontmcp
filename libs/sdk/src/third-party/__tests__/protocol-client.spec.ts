import * as client from '@frontmcp/protocol/client';

describe('#protocol-client', () => {
  it.each([
    ['the static variant', '../protocol-client'],
    ['the import variant', '../import-protocol-client'],
  ])('%s loads the MCP client and its transports from @frontmcp/protocol/client', async (_variant, path) => {
    const { loadProtocolClient } = await import(path);
    const loaded = await loadProtocolClient();

    expect(loaded.Client).toBe(client.Client);
    expect(loaded.StreamableHTTPClientTransport).toBe(client.StreamableHTTPClientTransport);
    expect(loaded.SSEClientTransport).toBe(client.SSEClientTransport);
  });
});
