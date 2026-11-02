/**
 * E2E: tools/list advertises a Zod-shape `outputSchema` as JSON Schema.
 *
 * Regression coverage for the bug where a hand-authored `outputSchema` declared
 * as a Zod raw shape (or `z.object`) was never converted to JSON Schema in
 * `tools/list` — only the OpenAPI `rawOutputSchema` passthrough was advertised,
 * so every hand-written tool shipped with no `outputSchema`.
 *
 * Verifies the SDK now converts structured object outputs (symmetric with
 * inputSchema), while primitive outputs correctly remain unadvertised (they flow
 * through `content`, and MCP requires `outputSchema` to be a top-level object).
 * A union whose members are all objects is listed too, typed `object` at the top.
 */
import { App, connect, FrontMcpInstance, Tool, ToolContext, z, type DirectMcpServer } from '@frontmcp/sdk';

const weatherOutput = { city: z.string(), tempF: z.number() };

@Tool({
  name: 'weather_struct',
  description: 'Weather with a Zod raw-shape outputSchema',
  inputSchema: { city: z.string() },
  outputSchema: weatherOutput,
})
class WeatherStructTool extends ToolContext {
  async execute(): Promise<{ city: string; tempF: number }> {
    return { city: 'Springfield', tempF: 72 };
  }
}

@Tool({
  name: 'zod_object_out',
  description: 'Tool with a z.object() outputSchema',
  inputSchema: { id: z.string() },
  outputSchema: z.object({ id: z.string(), label: z.string() }),
})
class ZodObjectOutTool extends ToolContext {
  async execute(input: { id: string }): Promise<{ id: string; label: string }> {
    return { id: input.id, label: 'demo' };
  }
}

@Tool({
  name: 'count_primitive',
  description: 'Tool with a primitive number outputSchema',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})
class CountPrimitiveTool extends ToolContext {
  async execute(input: { a: number; b: number }): Promise<number> {
    return input.a + input.b;
  }
}

const documentHit = z.object({ kind: z.literal('document'), title: z.string() });
const personHit = z.object({ kind: z.literal('person'), name: z.string() });

@Tool({
  name: 'search_union',
  description: 'Tool with a z.union() of objects outputSchema',
  inputSchema: { query: z.string() },
  outputSchema: z.union([documentHit, personHit]),
})
class SearchUnionTool extends ToolContext {
  async execute(input: { query: string }) {
    return { kind: 'document' as const, title: input.query };
  }
}

@Tool({
  name: 'resolve_discriminated',
  description: 'Tool with a z.discriminatedUnion() outputSchema',
  inputSchema: { handle: z.string() },
  outputSchema: z.discriminatedUnion('kind', [documentHit, personHit]),
})
class ResolveDiscriminatedTool extends ToolContext {
  async execute(input: { handle: string }) {
    return { kind: 'person' as const, name: input.handle };
  }
}

@App({
  name: 'OutputSchema',
  description: 'Tools exercising outputSchema advertisement',
  tools: [WeatherStructTool, ZodObjectOutTool, CountPrimitiveTool, SearchUnionTool, ResolveDiscriminatedTool],
})
class OutputSchemaApp {}

const outputSchemaServerConfig = {
  info: { name: 'output-schema-e2e', version: '0.0.0' },
  apps: [OutputSchemaApp],
  auth: { mode: 'public' as const },
};

type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, unknown>;
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
};

describe('tools/list outputSchema advertisement (E2E)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(outputSchemaServerConfig);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('advertises a Zod raw-shape outputSchema as JSON Schema', async () => {
    const { tools } = await server.listTools();
    const tool = tools.find((t) => t.name === 'weather_struct');
    expect(tool).toBeDefined();

    const out = tool?.outputSchema as JsonSchemaLike | undefined;
    expect(out?.type).toBe('object');
    expect(out?.properties?.['city']).toBeDefined();
    expect(out?.properties?.['tempF']).toBeDefined();
  });

  it('advertises a z.object() outputSchema as JSON Schema', async () => {
    const { tools } = await server.listTools();
    const out = tools.find((t) => t.name === 'zod_object_out')?.outputSchema as JsonSchemaLike | undefined;
    expect(out?.type).toBe('object');
    expect(out?.properties?.['label']).toBeDefined();
  });

  it('does not advertise an outputSchema for primitive output (flows via content)', async () => {
    const { tools } = await server.listTools();
    const tool = tools.find((t) => t.name === 'count_primitive');
    expect(tool).toBeDefined();
    expect(tool?.outputSchema).toBeUndefined();
  });

  it('advertises a z.union() of objects with a top-level object type and anyOf', async () => {
    const { tools } = await server.listTools();
    const out = tools.find((t) => t.name === 'search_union')?.outputSchema as JsonSchemaLike | undefined;

    expect(out?.type).toBe('object');
    expect(out?.anyOf?.map((member) => member.type)).toEqual(['object', 'object']);
    expect(out?.anyOf?.[0]?.properties?.['title']).toBeDefined();
  });

  it('advertises a z.discriminatedUnion() with a top-level object type and oneOf', async () => {
    const { tools } = await server.listTools();
    const out = tools.find((t) => t.name === 'resolve_discriminated')?.outputSchema as JsonSchemaLike | undefined;

    expect(out?.type).toBe('object');
    expect(out?.oneOf?.map((member) => member.type)).toEqual(['object', 'object']);
  });

  it('answers a union tool with structuredContent an MCP client validates against the listed schema', async () => {
    const client = await connect(outputSchemaServerConfig, { clientInfo: { name: 'schema-probe', version: '1.0.0' } });
    try {
      await client.listTools();
      const result = (await client.callTool('resolve_discriminated', { handle: 'Ada' })) as {
        structuredContent?: unknown;
      };

      expect(result.structuredContent).toEqual({ kind: 'person', name: 'Ada' });
    } finally {
      await client.close();
    }
  });
});
