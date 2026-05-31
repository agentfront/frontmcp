/**
 * E2E: cascading `output.schemaMode` controls how a tool's output schema is
 * exposed in `tools/list`.
 *
 * `schemaMode` is declarable on `@FrontMcp` / `@App` / `@Tool` and resolved with a
 * Tool > App > server > 'definition' cascade (see
 * `libs/sdk/src/common/metadata/output-policy.ts` +
 * `libs/sdk/src/tool/flows/tools-list.flow.ts`):
 *
 *   - 'definition' (default): advertise as the tool's `outputSchema` (JSON Schema).
 *   - 'description': fold a readable rendering into `description`, omit `outputSchema`.
 *   - 'both': advertise as `outputSchema` AND fold into the description.
 *   - 'none': expose it nowhere.
 *
 * Driven through the real `tools/list` flow via `server.listTools()`.
 */
import { App, FrontMcpInstance, Tool, ToolContext, z, type DirectMcpServer } from '@frontmcp/sdk';

// A structured (top-level object) output so the schema is eligible for both
// outputSchema advertisement and the description rendering.
const itemOutput = { id: z.string(), label: z.string() };
type ItemOut = { id: string; label: string };

@Tool({
  name: 'mode_description',
  description: 'Base description.',
  inputSchema: { id: z.string() },
  outputSchema: itemOutput,
  output: { schemaMode: 'description' },
})
class DescriptionModeTool extends ToolContext {
  async execute(input: { id: string }): Promise<ItemOut> {
    return { id: input.id, label: 'demo' };
  }
}

@Tool({
  name: 'mode_none',
  description: 'No output schema exposed.',
  inputSchema: { id: z.string() },
  outputSchema: itemOutput,
  output: { schemaMode: 'none' },
})
class NoneModeTool extends ToolContext {
  async execute(input: { id: string }): Promise<ItemOut> {
    return { id: input.id, label: 'demo' };
  }
}

@Tool({
  name: 'mode_both',
  description: 'Both definition and description.',
  inputSchema: { id: z.string() },
  outputSchema: itemOutput,
  output: { schemaMode: 'both' },
})
class BothModeTool extends ToolContext {
  async execute(input: { id: string }): Promise<ItemOut> {
    return { id: input.id, label: 'demo' };
  }
}

// Default tool: no `output` policy at all → inherits the cascade.
@Tool({
  name: 'mode_default',
  description: 'Inherits the cascade.',
  inputSchema: { id: z.string() },
  outputSchema: itemOutput,
})
class DefaultModeTool extends ToolContext {
  async execute(input: { id: string }): Promise<ItemOut> {
    return { id: input.id, label: 'demo' };
  }
}

// Tool that pins schemaMode back to 'definition', overriding a server-level 'none'.
@Tool({
  name: 'mode_override',
  description: 'Pins definition, overriding the server default.',
  inputSchema: { id: z.string() },
  outputSchema: itemOutput,
  output: { schemaMode: 'definition' },
})
class OverrideModeTool extends ToolContext {
  async execute(input: { id: string }): Promise<ItemOut> {
    return { id: input.id, label: 'demo' };
  }
}

@App({
  name: 'OutputModes',
  description: 'Tools exercising output.schemaMode per-tool',
  tools: [DescriptionModeTool, NoneModeTool, BothModeTool],
})
class OutputModesApp {}

@App({
  name: 'OutputCascade',
  description: 'Tools exercising the server-level output.schemaMode cascade',
  tools: [DefaultModeTool, OverrideModeTool],
})
class OutputCascadeApp {}

type JsonSchemaLike = { type?: string; properties?: Record<string, unknown> };

describe('tools/list output.schemaMode (E2E)', () => {
  describe('per-tool modes (default server policy)', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await FrontMcpInstance.createDirect({
        info: { name: 'output-modes-e2e', version: '0.0.0' },
        apps: [OutputModesApp],
        auth: { mode: 'public' as const },
      });
    });

    afterAll(async () => {
      await server.dispose();
    });

    it("'description' mode: omits outputSchema and folds the schema into the description", async () => {
      const { tools } = await server.listTools();
      const tool = tools.find((t) => t.name === 'mode_description');
      expect(tool).toBeDefined();

      // No advertised outputSchema in 'description' mode.
      expect(tool?.outputSchema).toBeUndefined();

      // The schema is rendered into the description (summary format) and the
      // original base description is preserved.
      expect(tool?.description).toContain('Base description.');
      expect(tool?.description).toContain('**Returns:**');
      expect(tool?.description).toContain('`id`');
      expect(tool?.description).toContain('`label`');
    });

    it("'none' mode: exposes the output schema nowhere", async () => {
      const { tools } = await server.listTools();
      const tool = tools.find((t) => t.name === 'mode_none');
      expect(tool).toBeDefined();

      expect(tool?.outputSchema).toBeUndefined();
      expect(tool?.description).toBe('No output schema exposed.');
      expect(tool?.description).not.toContain('**Returns:**');
    });

    it("'both' mode: advertises outputSchema AND folds it into the description", async () => {
      const { tools } = await server.listTools();
      const tool = tools.find((t) => t.name === 'mode_both');
      expect(tool).toBeDefined();

      const out = tool?.outputSchema as JsonSchemaLike | undefined;
      expect(out?.type).toBe('object');
      expect(out?.properties?.['id']).toBeDefined();
      expect(out?.properties?.['label']).toBeDefined();

      expect(tool?.description).toContain('Both definition and description.');
      expect(tool?.description).toContain('**Returns:**');
      expect(tool?.description).toContain('`label`');
    });
  });

  describe('server-level cascade and per-tool override', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await FrontMcpInstance.createDirect({
        info: { name: 'output-cascade-e2e', version: '0.0.0' },
        apps: [OutputCascadeApp],
        auth: { mode: 'public' as const },
        // Server default: suppress output schemas everywhere unless a tool/app overrides.
        output: { schemaMode: 'none' },
      });
    });

    afterAll(async () => {
      await server.dispose();
    });

    it('server-level none suppresses output schema for a tool with no own policy', async () => {
      const { tools } = await server.listTools();
      const tool = tools.find((t) => t.name === 'mode_default');
      expect(tool).toBeDefined();

      expect(tool?.outputSchema).toBeUndefined();
      expect(tool?.description).toBe('Inherits the cascade.');
      expect(tool?.description).not.toContain('**Returns:**');
    });

    it("a tool's 'definition' overrides the server-level 'none' and re-advertises outputSchema", async () => {
      const { tools } = await server.listTools();
      const tool = tools.find((t) => t.name === 'mode_override');
      expect(tool).toBeDefined();

      const out = tool?.outputSchema as JsonSchemaLike | undefined;
      expect(out?.type).toBe('object');
      expect(out?.properties?.['id']).toBeDefined();
      expect(out?.properties?.['label']).toBeDefined();

      // 'definition' does not touch the description.
      expect(tool?.description).toBe('Pins definition, overriding the server default.');
      expect(tool?.description).not.toContain('**Returns:**');
    });
  });
});
