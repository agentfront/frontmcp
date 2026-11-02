import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type LogRecord,
  type TemplateContext,
} from '../../../common';
import { InvalidOutputError } from '../../../errors';

const ToolHook = FlowHooksOf('tools:call-tool');
const finalizeFailures: unknown[] = [];

@Plugin({ name: 'refusal-probe' })
class RefusalProbe {
  @ToolHook.Finally('finalize')
  record(ctx: FlowCtxOf<'tools:call-tool'>) {
    finalizeFailures.push(ctx.state.flowError);
  }
}

@Tool({
  name: 'get_invoice',
  inputSchema: { id: z.string() },
  outputSchema: { id: z.string(), total: z.number() },
})
class GetInvoiceTool extends ToolContext {
  async execute(input: { id: string }) {
    return { id: input.id, total: '12.50 EUR', internalCostCenter: 'CC-7731' } as unknown as {
      id: string;
      total: number;
    };
  }
}

@Tool({ name: 'measure_ratio', inputSchema: {}, outputSchema: { ratio: z.number() } })
class MeasureRatioTool extends ToolContext {
  async execute() {
    return { ratio: Infinity, internalCostCenter: 'CC-7731' } as unknown as { ratio: number };
  }
}

@Tool({ name: 'label_ratio', inputSchema: {}, outputSchema: { label: z.string() } })
class LabelRatioTool extends ToolContext {
  async execute() {
    return { label: Infinity } as unknown as { label: string };
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  tools: [GetInvoiceTool, MeasureRatioTool, LabelRatioTool],
  plugins: [RefusalProbe],
})
class BillingApp {}

describe('tools/call output schema enforcement', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'output-schema', version: '1.0.0' }, apps: [BillingApp] });
  });

  async function callGetInvoice() {
    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'get_invoice',
      arguments: { id: 'INV-1' },
    });
    return message.result ?? {};
  }

  it('fails the call with INVALID_OUTPUT when the result violates outputSchema', async () => {
    const result = await callGetInvoice();
    const resultMeta = result['_meta'] as Record<string, unknown> | undefined;

    expect({ isError: result['isError'], code: resultMeta?.['code'] }).toEqual({
      isError: true,
      code: 'INVALID_OUTPUT',
    });
  });

  it('never sends fields outside outputSchema when the result violates it', async () => {
    const result = await callGetInvoice();
    const content = (result['content'] as Array<{ text?: string }> | undefined) ?? [];

    expect(result['structuredContent'] ?? {}).not.toHaveProperty('internalCostCenter');
    expect(content.map((block) => block.text ?? '').join('\n')).not.toContain('CC-7731');
  });

  it('records the refusal as state.flowError for the Finally hooks of finalize', async () => {
    finalizeFailures.length = 0;

    await callGetInvoice();
    await rpc20260728(server.handler, 'tools/call', { name: 'measure_ratio', arguments: {} });

    expect(finalizeFailures).toEqual([expect.any(InvalidOutputError), expect.any(InvalidOutputError)]);
    expect((finalizeFailures[1] as InvalidOutputError).details?.reason).toBe('non-finite-number');
  });

  describe('non-finite numbers', () => {
    async function callTool(target: TestFetchServer, name: string) {
      const { message } = await rpc20260728(target.handler, 'tools/call', { name, arguments: {} });
      const result = message.result ?? {};
      const resultMeta = result['_meta'] as Record<string, unknown> | undefined;
      return { isError: result['isError'] === true, code: resultMeta?.['code'], result };
    }

    it('fails a number field holding Infinity with INVALID_OUTPUT by default', async () => {
      expect(await callTool(server, 'measure_ratio')).toMatchObject({ isError: true, code: 'INVALID_OUTPUT' });
    });

    it('accepts a number field holding Infinity when output.allowNonFinite is true', async () => {
      const allowingServer = await createTestFetchServer({
        info: { name: 'output-schema-non-finite', version: '1.0.0' },
        apps: [BillingApp],
        output: { allowNonFinite: true },
      });

      const { isError, result } = await callTool(allowingServer, 'measure_ratio');
      const content = (result['content'] as Array<{ text?: string }> | undefined) ?? [];

      expect(isError).toBe(false);
      expect(result['structuredContent']).toEqual({ ratio: null });
      expect(content.map((block) => block.text ?? '').join('\n')).not.toContain('CC-7731');
    });

    it('still fails a string field holding Infinity when output.allowNonFinite is true', async () => {
      const allowingServer = await createTestFetchServer({
        info: { name: 'output-schema-non-finite-string', version: '1.0.0' },
        apps: [BillingApp],
        output: { allowNonFinite: true },
      });

      expect(await callTool(allowingServer, 'label_ratio')).toMatchObject({ isError: true, code: 'INVALID_OUTPUT' });
    });
  });
});

const quoteWarnings: string[] = [];

@LogTransport({ name: 'UndeclaredKeysCapture', description: 'Keeps warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) quoteWarnings.push(record.message);
  }
}

const quoteAnswer = { price: 10, quoteCostCenter: 'QCC-4410' };

@Tool({ name: 'get_quote', inputSchema: {}, outputSchema: { price: z.number() } })
class GetQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer as { price: number };
  }
}

@Tool({
  name: 'get_strict_quote',
  inputSchema: {},
  outputSchema: { price: z.number() },
  output: { undeclaredKeys: 'fail' },
})
class GetStrictQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer as { price: number };
  }
}

@Tool({
  name: 'show_quote',
  inputSchema: {},
  outputSchema: { price: z.number() },
  ui: { template: (ctx: TemplateContext<unknown, { price: number }>) => JSON.stringify(ctx.output) },
})
class ShowQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer as { price: number };
  }
}

@Tool({ name: 'get_partner_quote', inputSchema: {}, outputSchema: { price: z.number() } })
class GetPartnerQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer as { price: number };
  }
}

@Tool({
  name: 'get_tagged_quote',
  inputSchema: { tags: z.array(z.string()) },
  outputSchema: { price: z.number() },
  output: { undeclaredKeys: 'warn' },
})
class GetTaggedQuoteTool extends ToolContext {
  async execute(input: { tags: string[] }) {
    return { price: 10, ...Object.fromEntries(input.tags.map((tag) => [tag, true])) } as { price: number };
  }
}

@App({ id: 'quotes', name: 'Quotes', tools: [GetQuoteTool, GetStrictQuoteTool, ShowQuoteTool, GetTaggedQuoteTool] })
class QuotesApp {}

@Tool({ name: 'get_plugin_quote', inputSchema: {}, outputSchema: { price: z.number() } })
class GetPluginQuoteTool extends ToolContext {
  async execute() {
    return quoteAnswer as { price: number };
  }
}

@Plugin({ name: 'partner-pricing', tools: [GetPluginQuoteTool] })
class PartnerPricingPlugin {}

@App({
  id: 'partners',
  name: 'Partners',
  tools: [GetPartnerQuoteTool],
  plugins: [PartnerPricingPlugin],
  output: { undeclaredKeys: 'keep' },
})
class PartnersApp {}

describe('tools/call undeclared output keys', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
    quoteWarnings.length = 0;
  });

  function startServer(output?: { undeclaredKeys?: 'strip' | 'keep' | 'warn' | 'fail' }) {
    return createTestFetchServer({
      info: { name: 'undeclared-keys', version: '1.0.0' },
      apps: [QuotesApp, PartnersApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
      ...(output && { output }),
    });
  }

  async function callQuote(target: TestFetchServer, name: string, clientInfo?: { name: string; version: string }) {
    const { message } = await rpc20260728(
      target.handler,
      'tools/call',
      { name, arguments: {} },
      clientInfo && { meta: { [MCP_20260728_META.clientInfo]: clientInfo } },
    );
    const result = message.result ?? {};
    const resultMeta = result['_meta'] as Record<string, unknown> | undefined;
    return {
      isError: result['isError'] === true,
      code: resultMeta?.['code'],
      structuredContent: result['structuredContent'],
      wire: JSON.stringify(result),
    };
  }

  it('strips undeclared keys without a warning by default outside development', async () => {
    process.env['NODE_ENV'] = 'production';
    const server = await startServer();

    expect(await callQuote(server, 'get_quote')).toMatchObject({ isError: false, structuredContent: { price: 10 } });
    expect(quoteWarnings.filter((line) => line.includes('quoteCostCenter'))).toEqual([]);
  });

  it('strips undeclared keys and warns once per tool and key set by default in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const server = await startServer();

    const first = await callQuote(server, 'get_quote');
    await callQuote(server, 'get_quote');

    expect(first).toMatchObject({ isError: false, structuredContent: { price: 10 } });
    expect(first.wire).not.toContain('QCC-4410');
    const warnings = quoteWarnings.filter((line) => line.includes('quoteCostCenter'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('get_quote');
  });

  async function callTaggedQuote(target: TestFetchServer, tags: string[]): Promise<void> {
    await rpc20260728(target.handler, 'tools/call', { name: 'get_tagged_quote', arguments: { tags } });
  }

  function taggedQuoteWarnings(): string[] {
    return quoteWarnings.filter((line) => line.includes('get_tagged_quote'));
  }

  it("names under 'warn' only the undeclared keys not reported before", async () => {
    const server = await startServer();

    await callTaggedQuote(server, ['rush']);
    await callTaggedQuote(server, ['rush', 'gift']);
    await callTaggedQuote(server, ['gift', 'rush']);

    expect(taggedQuoteWarnings()).toHaveLength(2);
    expect(taggedQuoteWarnings()[0]).toContain('stripped: rush.');
    expect(taggedQuoteWarnings()[1]).toContain('stripped: gift.');
  });

  it("stops reporting under 'warn' once a tool has named 100 undeclared keys", async () => {
    const server = await startServer();
    const manyTags = Array.from({ length: 120 }, (_unused, index) => `tag${String(index).padStart(3, '0')}`);

    await callTaggedQuote(server, manyTags);
    await callTaggedQuote(server, ['late-tag']);

    expect(taggedQuoteWarnings()).toHaveLength(1);
    expect(taggedQuoteWarnings()[0]).toContain('tag099.');
    expect(taggedQuoteWarnings()[0]).not.toContain('tag100');
  });

  it("passes undeclared keys through under a server-level 'keep'", async () => {
    const server = await startServer({ undeclaredKeys: 'keep' });

    const result = await callQuote(server, 'get_quote');

    expect(result).toMatchObject({ isError: false, structuredContent: quoteAnswer });
  });

  it("lets a tool's 'fail' override the server and refuse the answer with INVALID_OUTPUT", async () => {
    const server = await startServer({ undeclaredKeys: 'keep' });

    const result = await callQuote(server, 'get_strict_quote');

    expect(result).toMatchObject({ isError: true, code: 'INVALID_OUTPUT' });
    expect(result.wire).not.toContain('QCC-4410');
  });

  it("lets an app's policy override the server", async () => {
    const server = await startServer({ undeclaredKeys: 'fail' });

    expect(await callQuote(server, 'get_partner_quote')).toMatchObject({ structuredContent: quoteAnswer });
    expect(await callQuote(server, 'get_quote')).toMatchObject({ isError: true, code: 'INVALID_OUTPUT' });
  });

  it("applies an app's policy to a tool a plugin of that app contributes", async () => {
    const server = await startServer({ undeclaredKeys: 'fail' });

    expect(await callQuote(server, 'get_plugin_quote')).toMatchObject({
      isError: false,
      structuredContent: quoteAnswer,
    });
  });

  it.each([
    ['a client that takes structuredContent', undefined],
    ['a client that takes no structuredContent', { name: 'claude-desktop', version: '1.0.0' }],
  ])("renders a tool's UI from declared keys only under 'keep', for %s", async (_label, clientInfo) => {
    const server = await startServer({ undeclaredKeys: 'keep' });

    const result = await callQuote(server, 'show_quote', clientInfo);

    expect(result.isError).toBe(false);
    expect(result.wire).toContain('ui/html');
    expect(result.wire).not.toContain('QCC-4410');
  });

  it('refuses an unknown undeclaredKeys policy at boot', async () => {
    await expect(startServer({ undeclaredKeys: 'drop' } as unknown as { undeclaredKeys: 'strip' })).rejects.toThrow(
      /undeclaredKeys/,
    );
  });
});
