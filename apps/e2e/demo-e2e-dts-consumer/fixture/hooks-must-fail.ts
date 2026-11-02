import 'reflect-metadata';

import {
  AgentCallHook,
  FlowHooksOf,
  HttpHook,
  JobHook,
  ListResourcesHook,
  ListToolsHook,
  PromptHook,
  ResourceHook,
  ToolHook,
  type FlowCtxOf,
} from '@frontmcp/sdk';

const SkillsFilterHook = FlowHooksOf('skills:filter');

// Every hook decorator checks the decorated method's parameter against the flow's ctx.
export class WronglyTypedHooks {
  // @ts-expect-error toolName is a string
  @ToolHook.Will('execute')
  wrongType(ctx: { toolName: number }): void {
    void ctx;
  }

  // @ts-expect-error the call-tool ctx has no notAField
  @ToolHook.Will('execute')
  unknownField(ctx: { notAField: string }): void {
    void ctx;
  }

  // @ts-expect-error the ctx is not a number
  @ToolHook.Did('execute')
  notTheCtx(ctx: number): void {
    void ctx;
  }

  // @ts-expect-error a Finally hook gets the ctx alone, no second argument
  @ToolHook.Finally('finalize')
  extraArgument(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>): void {
    void [ctx, next];
  }

  // @ts-expect-error an Around hook's next() resolves to nothing
  @ToolHook.Around('execute')
  wrongNext(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<string>): void {
    void [ctx, next];
  }

  // @ts-expect-error a Stage hook gets the ctx of its own flow
  @ToolHook.Stage('execute')
  otherFlowsCtx(ctx: FlowCtxOf<'resources:read-resource'>): void {
    void ctx;
  }

  // @ts-expect-error the read-resource ctx has no toolName
  @ResourceHook.Will('execute')
  resourceToolName(ctx: { toolName: string }): void {
    void ctx;
  }

  // @ts-expect-error the get-prompt ctx has no uri
  @PromptHook.Will('execute')
  promptUri(ctx: { uri: string }): void {
    void ctx;
  }

  // @ts-expect-error the list-tools ctx has no toolName
  @ListToolsHook.Did('findTools')
  listToolName(ctx: { toolName: string }): void {
    void ctx;
  }

  // @ts-expect-error the list-resources ctx has no uri
  @ListResourcesHook.Will('findResources')
  listUri(ctx: { uri: string }): void {
    void ctx;
  }

  // @ts-expect-error the http:request ctx has no toolName
  @HttpHook.Will('router')
  httpToolName(ctx: { toolName: string }): void {
    void ctx;
  }

  // @ts-expect-error the call-agent ctx has no toolInput
  @AgentCallHook.Will('execute')
  agentToolInput(ctx: { toolInput: Record<string, unknown> }): void {
    void ctx;
  }

  // @ts-expect-error the execute-job ctx has no promptName
  @JobHook.Will('execute')
  jobPromptName(ctx: { promptName: string }): void {
    void ctx;
  }

  // @ts-expect-error FlowHooksOf() types its decorators the same way
  @SkillsFilterHook.Did('filterSkills')
  skillsToolName(ctx: { toolName: string }): void {
    void ctx;
  }
}
