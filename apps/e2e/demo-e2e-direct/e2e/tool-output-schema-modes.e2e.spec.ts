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
 *
 * `output.undeclaredKeys` decides what `tools/call` does with keys an answer carries that its
 * `outputSchema` does not declare: 'strip', 'warn' (strip and log once), 'keep' or 'fail'.
 * A call that renders the tool's UI sends declared keys only, whatever the policy.
 */
import {
  App,
  connect,
  FrontMcpInstance,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  z,
  type DirectMcpServer,
  type LogRecord,
} from '@frontmcp/sdk';

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

const UNDECLARED_VALUE = 'QCC-4410';
const quoteAnswer = { price: 10, quoteCostCenter: UNDECLARED_VALUE } as { price: number };
const quoteOutput = { price: z.number() };

@Tool({ name: 'quote_default', inputSchema: {}, outputSchema: quoteOutput })
class DefaultQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer;
  }
}

@Tool({ name: 'quote_warned', inputSchema: {}, outputSchema: quoteOutput, output: { undeclaredKeys: 'warn' } })
class WarnedQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer;
  }
}

@Tool({ name: 'quote_kept', inputSchema: {}, outputSchema: quoteOutput, output: { undeclaredKeys: 'keep' } })
class KeptQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer;
  }
}

@Tool({ name: 'quote_strict', inputSchema: {}, outputSchema: quoteOutput, output: { undeclaredKeys: 'fail' } })
class StrictQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer;
  }
}

@Tool({
  name: 'quote_view',
  inputSchema: {},
  outputSchema: quoteOutput,
  output: { undeclaredKeys: 'keep' },
  ui: { template: (ctx) => `<pre>${ctx.helpers.escapeHtml(JSON.stringify(ctx.output))}</pre>` },
})
class QuoteViewTool extends ToolContext {
  async execute() {
    return quoteAnswer;
  }
}

@App({
  name: 'UndeclaredKeys',
  description: 'Tools exercising output.undeclaredKeys',
  tools: [DefaultQuoteTool, WarnedQuoteTool, KeptQuoteTool, StrictQuoteTool, QuoteViewTool],
})
class UndeclaredKeysApp {}

const policyWarnings: string[] = [];

@LogTransport({ name: 'UndeclaredKeysE2eCapture', description: 'Keeps warnings for assertions' })
class PolicyWarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) policyWarnings.push(record.message);
  }
}

const undeclaredKeysServerConfig = {
  info: { name: 'undeclared-keys-e2e', version: '0.0.0' },
  apps: [UndeclaredKeysApp],
  auth: { mode: 'public' as const },
  // A client named quote-viewer is treated as Claude, which renders the UI without structuredContent.
  transport: { platformDetection: { mappings: [{ pattern: 'quote-viewer', platform: 'claude' as const }] } },
  logging: { level: LogLevel.Warn, enableConsole: false, transports: [PolicyWarningCapture] },
};

describe('tools/call output.undeclaredKeys (E2E)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(undeclaredKeysServerConfig);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("strips undeclared keys silently by default outside development ('strip')", async () => {
    const result = await server.callTool('quote_default', {});

    expect(result.structuredContent).toEqual({ price: 10 });
    expect(JSON.stringify(result)).not.toContain(UNDECLARED_VALUE);
    expect(policyWarnings.filter((line) => line.includes('quote_default'))).toEqual([]);
  });

  it("'warn' strips undeclared keys and warns once for the tool and key set", async () => {
    const first = await server.callTool('quote_warned', {});
    await server.callTool('quote_warned', {});

    expect(first.structuredContent).toEqual({ price: 10 });
    const warnings = policyWarnings.filter((line) => line.includes('quote_warned'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('quoteCostCenter');
  });

  it("'keep' passes undeclared keys through, and an MCP client accepts them against the listed schema", async () => {
    const client = await connect(undeclaredKeysServerConfig, {
      clientInfo: { name: 'policy-probe', version: '1.0.0' },
    });
    try {
      await client.listTools();
      const result = (await client.callTool('quote_kept', {})) as {
        structuredContent?: unknown;
        content?: Array<{ text?: string }>;
      };

      expect(result.structuredContent).toEqual({ price: 10, quoteCostCenter: UNDECLARED_VALUE });
      expect(result.content?.[0]?.text).toContain(UNDECLARED_VALUE);
    } finally {
      await client.close();
    }
  });

  it("'fail' refuses the answer with INVALID_OUTPUT", async () => {
    await expect(server.callTool('quote_strict', {})).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('a call that renders the UI sends declared keys only, even under keep', async () => {
    const result = await server.callTool('quote_view', {});

    expect(result._meta?.['ui/html']).toBeDefined();
    expect(result.structuredContent).toEqual({ price: 10 });
    expect(JSON.stringify(result)).not.toContain(UNDECLARED_VALUE);
  });

  it('a UI render for a client that takes no structuredContent sends declared keys only, even under keep', async () => {
    const client = await connect(undeclaredKeysServerConfig, {
      clientInfo: { name: 'quote-viewer', version: '1.0.0' },
    });
    try {
      const result = await client.callTool('quote_view', {});

      expect(JSON.stringify(result)).toContain('ui/html');
      expect(JSON.stringify(result)).not.toContain(UNDECLARED_VALUE);
    } finally {
      await client.close();
    }
  });
});
