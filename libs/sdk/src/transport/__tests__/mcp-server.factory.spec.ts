import { ElicitRequestSchema, InMemoryTransport, McpServer } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';

import { createMcpServer } from '../mcp-server.factory';

// The module the MCP SDK's Ajv validator comes from. The SDK bundles Ajv into it, so the spec counts the
// validators built rather than the Ajv instances.
const ajvModule: {
  AjvJsonSchemaValidator: new (...args: never[]) => object;
} = require('@modelcontextprotocol/server/validators/ajv');

const info = { name: 'factory-test', version: '1.0.0' };
const requestedSchema = {
  type: 'object' as const,
  properties: { age: { type: 'number' as const } },
  required: ['age'],
};

async function connectElicitingClient(server: McpServer, content: Record<string, unknown>): Promise<Client> {
  const client = new Client({ name: 'client', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('createMcpServer', () => {
  let validatorsBuilt: jest.SpyInstance;

  beforeEach(() => {
    const Original = ajvModule.AjvJsonSchemaValidator;
    validatorsBuilt = jest.spyOn(ajvModule, 'AjvJsonSchemaValidator').mockImplementation(function (...args: never[]) {
      return new Original(...args);
    });
  });

  afterEach(() => validatorsBuilt.mockRestore());

  it('builds no Ajv validator until it validates an elicitation result, then reuses it', async () => {
    const server = createMcpServer(info, { capabilities: {} });
    const client = await connectElicitingClient(server, { age: 30 });
    expect(validatorsBuilt).not.toHaveBeenCalled();

    await server.elicitInput({ message: 'Age?', requestedSchema });
    await server.elicitInput({ message: 'Age?', requestedSchema });
    expect(validatorsBuilt).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('accepts an elicitation result that matches the requested schema', async () => {
    const server = createMcpServer(info, { capabilities: {} });
    const client = await connectElicitingClient(server, { age: 30 });

    await expect(server.elicitInput({ message: 'Age?', requestedSchema })).resolves.toEqual({
      action: 'accept',
      content: { age: 30 },
    });
    await client.close();
  });

  it('rejects an elicitation result that does not match the requested schema, as the MCP server does', async () => {
    const results = await Promise.all(
      [createMcpServer(info, { capabilities: {} }), new McpServer(info, { capabilities: {} })].map(async (server) => {
        const client = await connectElicitingClient(server, { age: 'old' });
        const result = await server.elicitInput({ message: 'Age?', requestedSchema }).catch((error: Error) => error);
        await client.close();
        return result;
      }),
    );

    expect(results[0]).toBeInstanceOf(Error);
    expect(results[0]).toEqual(results[1]);
    expect((results[0] as Error).message).toContain('Elicitation response content does not match requested schema');
  });
});
