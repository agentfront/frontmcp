import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, FlowHooksOf, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../../common';
import { PublicMcpError } from '../../../errors';

const ToolHook = FlowHooksOf('tools:call-tool');
const hooksRun: string[] = [];
const toolsRun: string[] = [];
const scenario = { switchToVault: false, vaultOpen: true };

@Tool({ name: 'summary', inputSchema: {}, outputSchema: 'string' })
class SummaryTool extends ToolContext {
  async execute() {
    toolsRun.push('summary');
    return 'public summary';
  }
}

@Tool({ name: 'vault_summary', inputSchema: {}, outputSchema: 'string' })
class VaultSummaryTool extends ToolContext {
  @ToolHook.Will('execute')
  static markVault() {
    hooksRun.push('vault-static');
  }

  async execute() {
    toolsRun.push('vault_summary');
    return 'vault summary';
  }
}

@Plugin({ name: 'redirect' })
class RedirectPlugin {
  @ToolHook.Will('findTool')
  redirect(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const input = flowCtx.state.input;
    if (input?.name === 'summary' && scenario.switchToVault) {
      flowCtx.state.set('input', { ...input, name: 'vault_summary' });
    }
  }

  @ToolHook.Will('execute')
  markPublic() {
    hooksRun.push('public-app');
  }
}

@Plugin({ name: 'vault-guard' })
class VaultGuardPlugin {
  @ToolHook.Stage('execute')
  guard(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    hooksRun.push('vault-app');
    if (!scenario.vaultOpen) flowCtx.fail(new PublicMcpError('the vault is locked', 'VAULT_LOCKED', 403));
  }
}

@App({ id: 'public', name: 'Public', tools: [SummaryTool], plugins: [RedirectPlugin] })
class PublicApp {}

@App({ id: 'vault', name: 'Vault', tools: [VaultSummaryTool], plugins: [VaultGuardPlugin] })
class VaultApp {}

describe('tools/call when a hook switches to another tool', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'switched-tool', version: '1.0.0' },
      apps: [PublicApp, VaultApp],
    });
  });

  beforeEach(() => {
    hooksRun.length = 0;
    toolsRun.length = 0;
    scenario.switchToVault = false;
    scenario.vaultOpen = true;
  });

  async function callSummary(): Promise<string> {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'summary', arguments: {} });
    return JSON.stringify(message);
  }

  it("runs the requested tool's hooks when no hook switches it", async () => {
    expect(await callSummary()).toContain('public summary');
    expect(hooksRun).toEqual(['public-app']);
  });

  it("runs the app and static hooks of the tool it switched to, not the first tool's, in the stages to come", async () => {
    scenario.switchToVault = true;

    expect(await callSummary()).toContain('vault summary');
    expect(hooksRun.sort()).toEqual(['vault-app', 'vault-static']);
  });

  it("is refused by an execute-stage guard of the tool it switched to, before that tool's execute() runs", async () => {
    scenario.switchToVault = true;
    scenario.vaultOpen = false;

    const answer = await callSummary();

    expect(answer).toContain('the vault is locked');
    expect(toolsRun).toEqual([]);
    expect(hooksRun).not.toContain('public-app');
  });
});
