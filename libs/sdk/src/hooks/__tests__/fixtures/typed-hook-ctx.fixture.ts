import 'reflect-metadata';

import {
  AgentCallHook,
  ChannelListHook,
  ChannelSendHook,
  CompletionHook,
  HttpHook,
  HttpRouteHook,
  JobHook,
  ListPromptsHook,
  ListResourcesHook,
  ListResourceTemplatesHook,
  ListToolsHook,
  OAuthAuthorizeHook,
  OAuthCallbackHook,
  OAuthRegisterHook,
  OAuthTokenHook,
  PromptHook,
  ResourceHook,
  Tool,
  ToolContext,
  ToolHook,
  type FlowCtxOf,
} from '../../../index';

interface NotInAnyCtx {
  notAField: string;
}

export class EveryExportRejectsAParameterItsCtxDoesNotSatisfy {
  // @ts-expect-error the ctx has no notAField
  @ToolHook.Will('parseInput')
  tool(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ListToolsHook.Will('parseInput')
  listTools(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @HttpHook.Will('router')
  http(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @HttpRouteHook.Will('handle')
  httpRoute(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @OAuthAuthorizeHook.Will('parseInput')
  oauthAuthorize(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @OAuthCallbackHook.Will('parseInput')
  oauthCallback(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @OAuthTokenHook.Will('parseInput')
  oauthToken(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @OAuthRegisterHook.Will('parseInput')
  oauthRegister(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ResourceHook.Will('parseInput')
  resource(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ListResourcesHook.Will('parseInput')
  listResources(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ListResourceTemplatesHook.Will('parseInput')
  listResourceTemplates(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @PromptHook.Will('parseInput')
  prompt(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ListPromptsHook.Will('parseInput')
  listPrompts(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @CompletionHook.Will('parseInput')
  completion(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @AgentCallHook.Will('parseInput')
  agentCall(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @JobHook.Will('parseInput')
  job(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ChannelSendHook.Will('parseInput')
  channelSend(ctx: NotInAnyCtx) {
    return ctx;
  }

  // @ts-expect-error the ctx has no notAField
  @ChannelListHook.Will('listChannels')
  channelList(ctx: NotInAnyCtx) {
    return ctx;
  }
}

export class EveryDecoratorRejectsAWronglyTypedParameter {
  // @ts-expect-error toolName is a string
  @ToolHook.Stage('execute')
  stage(ctx: { toolName: number }) {
    return ctx;
  }

  // @ts-expect-error toolName is a string
  @ToolHook.Did('execute')
  did(ctx: { toolName: number }) {
    return ctx;
  }

  // @ts-expect-error toolName is a string
  @ToolHook.Around('execute')
  around(ctx: { toolName: number }, next: () => Promise<void>) {
    return [ctx, next];
  }

  // @ts-expect-error toolName is a string
  @ToolHook.Finally('execute')
  finally(ctx: { toolName: number }) {
    return ctx;
  }

  // @ts-expect-error a Will hook gets no second argument
  @ToolHook.Will('execute')
  extraArgument(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>) {
    return [ctx, next];
  }
}

export class HooksThatCompile {
  @ToolHook.Will('parseInput')
  flowCtx(ctx: FlowCtxOf<'tools:call-tool'>) {
    return [ctx.toolName, ctx.toolInput, ctx.request.clientInfo?.name, ctx.error?.message];
  }

  @ToolHook.Did('findTool')
  structuralSubset(ctx: { toolName: string; state: { input?: { name: string } } }) {
    return ctx.toolName;
  }

  @ToolHook.Around('execute')
  async around(ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<unknown>) {
    await next();
    ctx.notify.listChanged('tools');
  }

  @ToolHook.Finally('finalize')
  noParameter() {
    return undefined;
  }

  @ResourceHook.Will('execute')
  resource(ctx: FlowCtxOf<'resources:read-resource'>) {
    return ctx.uri;
  }

  @PromptHook.Will('execute')
  prompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    return ctx.promptName;
  }
}

@Tool({ name: 'typed-ctx', inputSchema: {} })
export class ToolWithItsOwnHooks extends ToolContext {
  @ToolHook.Will('findTool')
  static beforeFind(ctx: FlowCtxOf<'tools:call-tool'>) {
    return ctx.toolName;
  }

  @ToolHook.Did('execute')
  afterExecute() {
    return this.input;
  }

  async execute() {
    return 'ok';
  }
}
