import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, FlowHooksOf, Plugin, Provider, Tool, ToolContext, type FlowCtxOf } from '../../common';

const ToolHook = FlowHooksOf('tools:call-tool');

const trace: string[] = [];

@Plugin({ name: 'trace' })
class TracePlugin {
  @ToolHook.Will('execute', { priority: 0 })
  willPriorityZero() {
    trace.push('Will p0');
  }

  @ToolHook.Will('execute', { priority: 100 })
  willPriorityHundred() {
    trace.push('Will p100');
  }

  @ToolHook.Did('execute', { priority: 0 })
  didPriorityZero() {
    trace.push('Did p0');
  }

  @ToolHook.Did('execute', { priority: 100 })
  didPriorityHundred() {
    trace.push('Did p100');
  }

  @ToolHook.Around('execute')
  async aroundExecute(_ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<unknown>) {
    trace.push('Around: before next()');
    await next();
    trace.push('Around: after next()');
  }
}

@Tool({ name: 'get_ticket', inputSchema: {} })
class GetTicketTool extends ToolContext {
  async execute() {
    trace.push('EXECUTE get_ticket');
    return { ok: true };
  }

  @ToolHook.Will('execute')
  onToolClass() {
    trace.push('hook on @Tool class');
  }
}

@Provider({ name: 'audit-hooks' })
class AuditHooks {
  @ToolHook.Will('execute')
  onAppProvider() {
    trace.push('hook on @App provider');
  }
}

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool], plugins: [TracePlugin], providers: [AuditHooks] })
class DeskApp {}

@Tool({ name: 'get_invoice', inputSchema: {} })
class GetInvoiceTool extends ToolContext {
  async execute() {
    trace.push('EXECUTE get_invoice');
    return { ok: true };
  }
}

@App({ id: 'billing', name: 'Billing', tools: [GetInvoiceTool] })
class BillingApp {}

describe('tools:call-tool flow hooks', () => {
  let server: TestFetchServer;
  let deskTrace: string[];
  let billingTrace: string[];

  async function traceToolCall(name: string): Promise<string[]> {
    trace.length = 0;
    await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
    return [...trace];
  }

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'flow-hooks', version: '1.0.0' },
      apps: [DeskApp, BillingApp],
    });
    deskTrace = await traceToolCall('get_ticket');
    billingTrace = await traceToolCall('get_invoice');
  });

  it('runs the execute stage inside the next() of an Around hook', () => {
    const aroundAndExecute = deskTrace.filter((entry) => entry.startsWith('Around') || entry.startsWith('EXECUTE'));

    expect(aroundAndExecute).toEqual(['Around: before next()', 'EXECUTE get_ticket', 'Around: after next()']);
  });

  it('runs Will hooks with a lower priority first', () => {
    expect(deskTrace.filter((entry) => entry.startsWith('Will p'))).toEqual(['Will p0', 'Will p100']);
  });

  it('runs Did hooks with a lower priority first', () => {
    expect(deskTrace.filter((entry) => entry.startsWith('Did p'))).toEqual(['Did p0', 'Did p100']);
  });

  it('runs a hook declared on the @Tool class', () => {
    expect(deskTrace).toContain('hook on @Tool class');
  });

  it('runs a hook declared on a provider listed in @App providers', () => {
    expect(deskTrace).toContain('hook on @App provider');
  });

  it('does not run hooks of a plugin registered on another app', () => {
    expect(billingTrace).toEqual(['EXECUTE get_invoice']);
  });
});
