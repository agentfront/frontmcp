import 'reflect-metadata';

import {
  CompletionHook,
  DynamicAdapter,
  FlowHooksOf,
  FrontMcp,
  ListPromptsHook,
  PromptHook,
  type FlowCtxOf,
  type FrontMcpAdapterResponse,
  type ScopeEntry,
} from '@frontmcp/sdk';

// The prompt and completion flows are in the published type graph (#678).
const GetPrompt = FlowHooksOf('prompts:get-prompt');
const ListPrompts = FlowHooksOf('prompts:list-prompts');
const Complete = FlowHooksOf('completion:complete');

export class PromptAudit {
  @GetPrompt.Will('execute')
  beforePrompt(ctx: FlowCtxOf<'prompts:get-prompt'>): void {
    void ctx.state.prompt?.name;
  }

  @ListPrompts.Did('findPrompts')
  afterList(): void {}

  @Complete.Will('complete')
  beforeComplete(): void {}

  @PromptHook.Did('execute')
  afterPrompt(): void {}

  @ListPromptsHook.Will('findPrompts')
  beforeList(): void {}

  @CompletionHook.Did('complete')
  afterComplete(): void {}
}

// ScopeEntry declares the channel accessors, so no cast is needed.
export function raise(scope: ScopeEntry): void {
  scope.channelEventBus?.emit('app:error', { message: 'Connection refused' });
  void scope.channelNotifications?.send('status', 'maintenance');
  void scope.channels?.findByName('status');
}

interface StatusOptions {
  name: string;
}

class StatusAdapter extends DynamicAdapter<StatusOptions> {
  constructor(readonly options: StatusOptions) {
    super();
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    return { tools: [] };
  }
}

// Server-level adapters are part of the @FrontMcp config.
@FrontMcp({
  info: { name: 'dts-hooks', version: '1.0.0' },
  apps: [],
  serve: false,
  adapters: [StatusAdapter.init({ name: 'status' })],
})
export class HooksServer {}
