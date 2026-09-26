import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  Plugin,
  Prompt,
  PromptContext,
  ResourceContext,
  ResourceTemplate,
  type FlowCtxOf,
  type ResourceCompletionResult,
} from '../../../common';

const CompleteHook = FlowHooksOf('completion:complete');

const referencesSeen: string[] = [];

@Plugin({ name: 'completion-audit' })
class CompletionAuditPlugin {
  @CompleteHook.Will('complete')
  recordReference(ctx: FlowCtxOf<'completion:complete'>) {
    referencesSeen.push(`${ctx.state.prompt?.name ?? '-'}|${ctx.state.resource?.name ?? '-'}`);
  }
}

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{ticketId}' })
class TicketResource extends ResourceContext<{ ticketId: string }> {
  async ticketIdCompleter(partial: string): Promise<ResourceCompletionResult> {
    return { values: ['T-1', 'T-2'].filter((id) => id.startsWith(partial)) };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ticket' }] };
  }
}

@Prompt({ name: 'triage', arguments: [{ name: 'ticketId' }] })
class TriagePrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'triage' } }] };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  plugins: [CompletionAuditPlugin],
  resources: [TicketResource],
  prompts: [TriagePrompt],
})
class DeskApp {}

describe('completion:complete flow', () => {
  let server: TestFetchServer;

  async function complete(ref: Record<string, unknown>, value = 'T') {
    referencesSeen.length = 0;
    const { message } = await rpc20260728(server.handler, 'completion/complete', {
      ref,
      argument: { name: 'ticketId', value },
    });
    return message;
  }

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'completion', version: '1.0.0' }, apps: [DeskApp] });
  });

  it('resolves the referenced resource template before its completer runs', async () => {
    const message = await complete({ type: 'ref/resource', uri: 'tickets://{ticketId}' });

    expect(referencesSeen).toEqual(['-|ticket']);
    expect(message.result?.['completion']).toMatchObject({ values: ['T-1', 'T-2'] });
  });

  it('resolves the referenced prompt before completion runs', async () => {
    const message = await complete({ type: 'ref/prompt', name: 'triage' });

    expect(referencesSeen).toEqual(['triage|-']);
    expect(message.result?.['completion']).toMatchObject({ values: [] });
  });

  it('leaves the reference empty when nothing matches', async () => {
    const message = await complete({ type: 'ref/resource', uri: 'unknown://{ticketId}' });

    expect(referencesSeen).toEqual(['-|-']);
    expect(message.result?.['completion']).toMatchObject({ values: [] });
  });
});
