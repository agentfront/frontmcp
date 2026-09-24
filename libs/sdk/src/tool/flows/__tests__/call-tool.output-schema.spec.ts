import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

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

@App({ id: 'billing', name: 'Billing', tools: [GetInvoiceTool, MeasureRatioTool, LabelRatioTool] })
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
      expect(result['structuredContent']).not.toHaveProperty('internalCostCenter');
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
