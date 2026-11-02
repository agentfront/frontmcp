import 'reflect-metadata';

import {
  CompletionHook,
  DynamicAdapter,
  FlowHooksOf,
  FrontMcp,
  ListPromptsHook,
  PromptHook,
  ResourceHook,
  Tool,
  ToolContext,
  ToolHook,
  z,
  type FlowCtxOf,
  type FlowRequestInfo,
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

  @GetPrompt.Finally('execute')
  afterPromptWhateverItsOutcome(ctx: FlowCtxOf<'prompts:get-prompt'>): void {
    void ctx.state.flowError?.message;
  }
}

// Finally hooks run after a stage whatever its outcome, and read the failure from state.flowError.
export class CallAudit {
  @ToolHook.Finally('finalize')
  afterCall(ctx: FlowCtxOf<'tools:call-tool'>): void {
    void ctx.state.flowError?.message;
  }
}

// A hook's parameter is checked against the flow's ctx: FlowCtxOf, a structural subset of it, or none compiles.
export class TypedCallAudit {
  @ToolHook.Will('execute')
  beforeCall(ctx: FlowCtxOf<'tools:call-tool'>): void {
    const toolName: string = ctx.toolName;
    const toolInput: Record<string, unknown> | undefined = ctx.toolInput;
    const request: FlowRequestInfo = ctx.request;
    const clientName: string | undefined = ctx.request.clientInfo?.name;
    void [toolName, toolInput, request.sessionId, request.metadata?.userAgent, request.protocol, clientName];
    ctx.notify.listChanged('tools');
  }

  @ToolHook.Did('findTool')
  afterFind(ctx: { toolName: string; state: { input?: { name: string } } }): void {
    void ctx.toolName;
  }

  @ToolHook.Around('execute')
  async aroundCall(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<unknown>): Promise<void> {
    await next();
    void ctx.toolName;
  }

  @ToolHook.Finally('finalize')
  afterCallWhateverItsOutcome(ctx: FlowCtxOf<'tools:call-tool'>): void {
    const error: Error | undefined = ctx.error;
    void error?.message;
  }

  @ToolHook.Did('execute')
  untyped(ctx: unknown): void {
    void ctx;
  }

  @ResourceHook.Will('execute')
  beforeRead(ctx: FlowCtxOf<'resources:read-resource'>): void {
    const uri: string = ctx.uri;
    ctx.notify.listChanged('resources');
    void uri;
  }

  @PromptHook.Will('execute')
  beforeGetPrompt(ctx: FlowCtxOf<'prompts:get-prompt'>): void {
    const promptName: string = ctx.promptName;
    ctx.notify.listChanged('prompts');
    void promptName;
  }
}

// A tool class declares hooks on itself, static for the stages before its instance exists.
@Tool({ name: 'guarded-echo', inputSchema: { text: z.string() } })
export class GuardedEchoTool extends ToolContext {
  @ToolHook.Will('findTool')
  static beforeFind(ctx: FlowCtxOf<'tools:call-tool'>): void {
    void ctx.toolName;
  }

  @ToolHook.Did('execute')
  afterExecute(): void {
    void this.input;
  }

  async execute(input: { text: string }) {
    return input.text;
  }
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
