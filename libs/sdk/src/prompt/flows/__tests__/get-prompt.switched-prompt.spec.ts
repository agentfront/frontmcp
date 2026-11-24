import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, FlowHooksOf, Plugin, Prompt, PromptContext, ScopeEntry, type FlowCtxOf } from '../../../common';
import { PublicMcpError } from '../../../errors';

const PromptHook = FlowHooksOf('prompts:get-prompt');
const hooksRun: string[] = [];
const promptsRun: string[] = [];
const promptArguments = [
  { name: 'to', required: false },
  { name: 'pass', required: false },
  { name: 'seal', required: false },
];

function textResult(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

@Prompt({ name: 'summary', arguments: promptArguments })
class SummaryPrompt extends PromptContext {
  async execute() {
    return textResult('public summary');
  }
}

@Prompt({ name: 'vault_summary', arguments: promptArguments })
class VaultSummaryPrompt extends PromptContext {
  @PromptHook.Will('execute')
  static markVault() {
    hooksRun.push('vault-static');
  }

  async execute() {
    promptsRun.push('vault_summary');
    return textResult('vault summary');
  }
}

@Plugin({ name: 'redirect' })
class RedirectPlugin {
  @PromptHook.Did('findPrompt')
  redirect(flowCtx: FlowCtxOf<'prompts:get-prompt'>) {
    if (flowCtx.state.input?.arguments?.['to'] !== 'vault') return;
    const vault = flowCtx.get(ScopeEntry).prompts.findByName('vault_summary');
    if (vault) flowCtx.state.set('prompt', vault);
  }

  @PromptHook.Will('execute')
  markPublic() {
    hooksRun.push('public-app');
  }
}

@Plugin({ name: 'vault-guard' })
class VaultGuardPlugin {
  @PromptHook.Will('execute')
  guard(flowCtx: FlowCtxOf<'prompts:get-prompt'>) {
    hooksRun.push('vault-app');
    if (flowCtx.state.input?.arguments?.['pass'] !== 'open') {
      flowCtx.fail(new PublicMcpError('the vault is locked', 'VAULT_LOCKED', 403));
    }
  }

  @PromptHook.Stage('execute')
  checkSeal(flowCtx: FlowCtxOf<'prompts:get-prompt'>) {
    if (flowCtx.state.input?.arguments?.['seal'] === 'broken') {
      flowCtx.fail(new PublicMcpError('the vault seal is broken', 'VAULT_SEALED', 403));
    }
  }
}

@App({ id: 'public', name: 'Public', prompts: [SummaryPrompt], plugins: [RedirectPlugin] })
class PublicApp {}

@App({ id: 'vault', name: 'Vault', prompts: [VaultSummaryPrompt], plugins: [VaultGuardPlugin] })
class VaultApp {}

describe('prompts/get when a hook switches to another prompt', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'switched-prompt', version: '1.0.0' },
      apps: [PublicApp, VaultApp],
    });
  });

  beforeEach(() => {
    hooksRun.length = 0;
    promptsRun.length = 0;
  });

  async function getPrompt(name: string, args: Record<string, string>): Promise<string> {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name, arguments: args });
    return JSON.stringify(message);
  }

  async function getSummary(args: Record<string, string>): Promise<string> {
    return getPrompt('summary', args);
  }

  it("runs the requested prompt's hooks when no hook switches it", async () => {
    expect(await getSummary({})).toContain('public summary');
    expect(hooksRun).toEqual(['public-app']);
  });

  it("runs the app and static hooks of the prompt it switched to, not the first prompt's, in the stages to come", async () => {
    expect(await getSummary({ to: 'vault', pass: 'open' })).toContain('vault summary');
    expect(hooksRun.sort()).toEqual(['vault-app', 'vault-static']);
  });

  it('is refused by a guard of the prompt it switched to', async () => {
    const answer = await getSummary({ to: 'vault' });

    expect(answer).toContain('the vault is locked');
    expect(answer).not.toContain('vault summary');
    expect(hooksRun).not.toContain('public-app');
  });

  it("runs an execute-stage guard of the prompt it switched to before that prompt's execute(), as a direct request does", async () => {
    const direct = await getPrompt('vault_summary', { pass: 'open', seal: 'broken' });
    const switched = await getSummary({ to: 'vault', pass: 'open', seal: 'broken' });

    expect(direct).toContain('the vault seal is broken');
    expect(switched).toContain('the vault seal is broken');
    expect(promptsRun).toEqual([]);
  });
});
