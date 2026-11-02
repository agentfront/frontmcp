import 'reflect-metadata';

import {
  App,
  BUDGET_META_KEY,
  FrontMcp,
  Plugin,
  Tool,
  ToolContext,
  ToolHook,
  z,
  type BudgetNote,
  type ClientProfile,
  type FlowCtxOf,
  type OutputBudget,
} from '@frontmcp/sdk';

const budget: OutputBudget = { maxBytes: 64 * 1024, lists: 'keep-oldest' };
const codexProfile: ClientProfile = { structured: 'text', annotations: 'no-numbers', instructions: 'compact' };

@Tool({ name: 'events', inputSchema: {}, outputSchema: { events: z.array(z.string()) }, output: { budget: false } })
export class EventsTool extends ToolContext {
  async execute() {
    return { events: ['started'] };
  }
}

// A hook before the budget reads whether a client made the call, as the answer stages do.
@Plugin({ name: 'answer-tagger' })
export class AnswerTagger {
  @ToolHook.Will('fitAnswer')
  tag(ctx: FlowCtxOf<'tools:call-tool'>): void {
    if (ctx.isClientCall() && ctx.state.output) ctx.respond({ ...ctx.state.output, _meta: { tagged: true } });
  }
}

@App({ name: 'Events', tools: [EventsTool], plugins: [AnswerTagger], output: { budget } })
export class EventsApp {}

@FrontMcp({
  info: { name: 'events', version: '1.0.0' },
  apps: [EventsApp],
  http: { forwardHeaders: ['x-acme-*'] },
  output: { budget: { maxBytes: 128 * 1024 } },
  clients: { 'codex*': codexProfile, 'claude-code': { structured: 'only' } },
})
export class EventsServer {}

export function omittedItems(meta: Record<string, unknown> | undefined): number {
  const note = meta?.[BUDGET_META_KEY] as BudgetNote | undefined;
  return note?.omitted.reduce((sum, omission) => sum + (omission.items ?? 0), 0) ?? 0;
}
