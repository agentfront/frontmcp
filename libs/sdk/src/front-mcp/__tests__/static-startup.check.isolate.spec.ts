/**
 * `assertStaticStartupConfig` runs while an edge module evaluates, where Cloudflare Workers refuse to
 * generate random values ("Disallowed operation called within global scope"). The startup error it
 * throws there must be its own, naming the entries, not the platform's refusal of the random error id
 * every FrontMCP error used to draw in its constructor.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { UnenforcedMetadataError } from '../../errors';
import { assertStaticStartupConfig } from '../static-startup.check';

const ISOLATE_REFUSAL =
  'Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a ' +
  'timeout, and generating random values are not allowed within global scope.';

let mockRefuseRandomness = false;

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    randomBytes: (length: number) => {
      if (mockRefuseRandomness) throw new Error(ISOLATE_REFUSAL);
      return actual.randomBytes(length);
    },
  };
});

// The plugin field is declared by the approval plugin's type augmentation, which this test does not load.
const APPROVAL: Record<string, unknown> = { approval: true };

@Tool({ name: 'refund_invoice', inputSchema: {}, ...APPROVAL })
class RefundInvoiceTool extends ToolContext {
  async execute() {
    return { refunded: true };
  }
}

@App({ id: 'billing', name: 'Billing', tools: [RefundInvoiceTool] })
class BillingApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'isolate-startup', version: '1.0.0' },
  apps: [BillingApp],
  logging: { level: LogLevel.Off },
};

describe('assertStaticStartupConfig on an isolate that refuses randomness', () => {
  afterEach(() => {
    mockRefuseRandomness = false;
  });

  it('throws the startup error, naming the entry', () => {
    mockRefuseRandomness = true;
    let thrown: unknown;
    try {
      assertStaticStartupConfig(config);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnenforcedMetadataError);
    expect((thrown as Error).message).toContain(`Tool "refund_invoice" declares 'approval'`);
    expect((thrown as UnenforcedMetadataError).errorId).toMatch(/^err_[0-9a-f]{16}$/);
  });
});
