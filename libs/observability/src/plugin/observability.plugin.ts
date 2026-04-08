import {
  DynamicPlugin,
  Plugin,
  ProviderType,
  ProviderScope,
  FRONTMCP_CONTEXT,
  ToolHook,
  ResourceHook,
  HttpHook,
  ListToolsHook,
  ListResourcesHook,
  ListResourceTemplatesHook,
  AgentCallHook,
  FlowHooksOf,
} from '@frontmcp/sdk';
import { trace } from '@opentelemetry/api';
import type {
  ObservabilityPluginOptions,
  ObservabilityPluginOptionsInput,
  ObservabilityLoggingOptions,
} from './observability.plugin.types';
import type { TracingOptions } from '../otel/otel.types';
import type { RequestLogCollectorOptions } from '../request-log/request-log.types';
import { OTEL_TRACER, OTEL_CONFIG } from '../otel/otel.tokens';
import { REQUEST_LOG_COLLECTOR } from '../request-log/request-log.tokens';
import { RequestLogCollector } from '../request-log/request-log.collector';
import { StructuredLogTransport } from '../logging/structured-log-transport';
import { createSinks } from '../logging/sink.factory';

import { TelemetryAccessor } from '../telemetry/telemetry.accessor';
import { TELEMETRY_ACCESSOR } from '../telemetry/telemetry.tokens';

import {
  // HTTP flow
  onHttpWillTrace,
  onHttpWillAcquireQuota,
  onHttpDidAcquireQuota,
  onHttpWillCheckAuth,
  onHttpDidCheckAuth,
  onHttpWillRoute,
  onHttpDidRoute,
  onHttpDidFinalize,
  // Tool flow
  onToolWillParse,
  onToolWillFindTool,
  onToolWillCheckAuth as onToolCheckAuth,
  onEntryWillCheckAuthorities,
  onEntryDidCheckAuthorities,
  onToolWillCreateContext,
  onToolWillValidateInput,
  onToolWillExecute,
  onToolDidExecute,
  onToolWillValidateOutput,
  onToolWillApplyUI,
  onToolDidFinalize,
  // Resource flow
  onResourceWillParse,
  onResourceWillFind,
  onResourceWillExecute,
  onResourceDidExecute,
  onResourceDidFinalize,
  // Prompt flow
  onPromptWillParse,
  onPromptWillFind,
  onPromptWillExecute,
  onPromptDidExecute,
  onPromptDidFinalize,
  // Agent flow
  onAgentWillParse,
  onAgentWillFind,
  onAgentWillExecute,
  onAgentDidExecute,
  onAgentDidFinalize,
  onAgentDidExecuteEnrich,
  // Generic flow helpers
  onGenericFlowWillStart,
  onGenericFlowStage,
  onGenericFlowDidFinalize,
  // Transport flows
  onTransportWillStart,
  onTransportDidRoute,
  onTransportStage,
  onTransportDidFinalize,
  // Auth flows
  onAuthWillStart,
  onAuthDidDetermineMode,
  onAuthStage,
  onAuthDidFinalize,
  // Fetch wrapping
  wrapContextFetch,
  // Startup report
  reportStartup,
  // Session tracing ID
  sessionTracingId,
} from './observability.hooks';
import type { StartupTelemetryData } from '../otel/spans/startup.span';

// Hook decorators for flows without SDK-exported constants
const PromptHook = FlowHooksOf('prompts:get-prompt' as any);
const ListPromptsHook = FlowHooksOf('prompts:list-prompts' as any);
const SkillSearchHook = FlowHooksOf('skills:search' as any);
const SkillLoadHook = FlowHooksOf('skills:load' as any);
const CompletionHook = FlowHooksOf('completion:complete' as any);

// Transport flow hooks
const LegacySseHook = FlowHooksOf('handle:legacy-sse' as any);
const StreamableHttpHook = FlowHooksOf('handle:streamable-http' as any);
const StatelessHttpHook = FlowHooksOf('handle:stateless-http' as any);

// Auth flow hooks
const AuthVerifyHook = FlowHooksOf('auth:verify' as any);
const SessionVerifyHook = FlowHooksOf('session:verify' as any);

// OAuth flow hooks
const OAuthTokenHook = FlowHooksOf('oauth:token' as any);
const OAuthAuthorizeHook = FlowHooksOf('oauth:authorize' as any);
const OAuthCallbackHook = FlowHooksOf('oauth:callback' as any);
const OAuthProviderCallbackHook = FlowHooksOf('oauth:provider-callback' as any);
const OAuthRegisterHook = FlowHooksOf('oauth:register' as any);

// Elicitation flow hooks
const ElicitRequestHook = FlowHooksOf('elicitation:request' as any);
const ElicitResultHook = FlowHooksOf('elicitation:result' as any);

// Resource subscription hooks
const SubscribeResourceHook = FlowHooksOf('resources:subscribe' as any);
const UnsubscribeResourceHook = FlowHooksOf('resources:unsubscribe' as any);

// Skills HTTP hooks
const SkillsHttpLlmTxtHook = FlowHooksOf('skills-http:llm-txt' as any);
const SkillsHttpLlmFullTxtHook = FlowHooksOf('skills-http:llm-full-txt' as any);
const SkillsHttpApiHook = FlowHooksOf('skills-http:api' as any);

// Well-known hooks
const WellKnownJwksHook = FlowHooksOf('well-known.jwks' as any);
const WellKnownOAuthServerHook = FlowHooksOf('well-known.oauth-authorization-server' as any);
const WellKnownPrmHook = FlowHooksOf('well-known.prm' as any);

// Logging hooks
const LoggingSetLevelHook = FlowHooksOf('logging:set-level' as any);

const DEFAULT_TRACING: TracingOptions = {
  httpSpans: true,
  executionSpans: true,
  hookSpans: false,
  fetchSpans: true,
  flowStageEvents: true,
  transportSpans: true,
  authSpans: true,
  oauthSpans: true,
  elicitationSpans: true,
  startupReport: true,
};

/**
 * ObservabilityPlugin — comprehensive, zero-config OpenTelemetry instrumentation
 * for the entire FrontMCP system.
 *
 * When installed, spans are created automatically for:
 * - HTTP requests (every stage: trace → auth → route → transport → finalize)
 * - Tool calls (parseInput → findTool → auth → validate → execute → UI → finalize)
 * - Resource reads (parseInput → find → execute → validate → finalize)
 * - Prompt invocations (parseInput → find → execute → validate → finalize)
 * - Agent calls (parseInput → find → auth → validate → execute → finalize)
 * - Skills (search, load)
 * - List operations (tools, resources, prompts, resource templates)
 * - Completions
 * - Session lifecycle (creation, auth verification)
 *
 * Single trace ID per request. Privacy-safe session tracing ID.
 * Every flow stage recorded as a timed span event.
 */
@Plugin({
  name: 'observability',
  description: 'Full-system OpenTelemetry instrumentation, structured logging, and request logs',
  providers: [],
  contextExtensions: [
    {
      property: 'telemetry',
      token: TELEMETRY_ACCESSOR,
      errorMessage:
        'ObservabilityPlugin is not installed or tracing is disabled. ' +
        'Add ObservabilityPlugin.init() to your plugins array.',
    },
  ],
})
export default class ObservabilityPlugin extends DynamicPlugin<
  ObservabilityPluginOptions,
  ObservabilityPluginOptionsInput
> {
  static defaultOptions: ObservabilityPluginOptions = {
    tracing: DEFAULT_TRACING,
    logging: false,
    requestLogs: false,
  };

  options: ObservabilityPluginOptions;
  private tracingOpts: TracingOptions;

  constructor(options: ObservabilityPluginOptionsInput = {}) {
    super();
    this.options = resolveOptions(options);
    this.tracingOpts = this.options.tracing !== false ? this.options.tracing : DEFAULT_TRACING;
  }

  private get tracingEnabled(): boolean {
    return this.options.tracing !== false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP Request Flow — scope:http-request
  // Every stage: traceRequest → acquireQuota → acquireSemaphore →
  //   checkAuthorization → router → handle* → audit → metrics → finalize
  // ═══════════════════════════════════════════════════════════════════════════

  @HttpHook.Will('traceRequest', { priority: -1000 })
  _httpWillTrace(ctx: unknown): void {
    if (this.tracingEnabled) onHttpWillTrace(this.tracingOpts, ctx);
  }

  @HttpHook.Will('acquireQuota', { priority: -1000 })
  _httpWillQuota(ctx: unknown): void {
    if (this.tracingEnabled) onHttpWillAcquireQuota(ctx);
  }

  @HttpHook.Did('acquireSemaphore', { priority: 1000 })
  _httpDidSemaphore(ctx: unknown): void {
    if (this.tracingEnabled) onHttpDidAcquireQuota(ctx);
  }

  @HttpHook.Will('checkAuthorization', { priority: -1000 })
  _httpWillAuth(ctx: unknown): void {
    if (this.tracingEnabled) onHttpWillCheckAuth(ctx);
  }

  @HttpHook.Did('checkAuthorization', { priority: 1000 })
  _httpDidAuth(ctx: unknown): void {
    if (this.tracingEnabled) onHttpDidCheckAuth(ctx);
  }

  @HttpHook.Will('router', { priority: -1000 })
  _httpWillRoute(ctx: unknown): void {
    if (this.tracingEnabled) onHttpWillRoute(ctx);
  }

  @HttpHook.Did('router', { priority: 1000 })
  _httpDidRoute(ctx: unknown): void {
    if (this.tracingEnabled) onHttpDidRoute(ctx);
  }

  @HttpHook.Did('finalize', { priority: 1000 })
  _httpDidFinalize(ctx: unknown): void {
    if (this.tracingEnabled) onHttpDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tool Call Flow — tools:call-tool
  // Every stage: parseInput → findTool → checkToolAuthorization →
  //   createToolCallContext → acquireQuota → acquireSemaphore →
  //   validateInput → execute → validateOutput → applyUI → finalize
  // ═══════════════════════════════════════════════════════════════════════════

  @ToolHook.Will('parseInput', { priority: -1000 })
  _toolWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillParse(this.tracingOpts, ctx);
  }

  @ToolHook.Will('findTool', { priority: -1000 })
  _toolWillFind(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillFindTool(ctx);
  }

  @ToolHook.Will('checkToolAuthorization', { priority: -1000 })
  _toolWillCheckAuth(ctx: unknown): void {
    if (this.tracingEnabled) onToolCheckAuth(ctx);
  }

  @ToolHook.Will('checkEntryAuthorities', { priority: -1000 })
  _toolWillCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryWillCheckAuthorities(ctx);
  }

  @ToolHook.Did('checkEntryAuthorities', { priority: 1000 })
  _toolDidCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryDidCheckAuthorities(ctx);
  }

  @ToolHook.Will('createToolCallContext', { priority: -1000 })
  _toolWillCreateCtx(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillCreateContext(ctx);
  }

  @ToolHook.Will('validateInput', { priority: -1000 })
  _toolWillValidate(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillValidateInput(ctx);
  }

  @ToolHook.Will('execute', { priority: -1000 })
  _toolWillExecute(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillExecute(this.tracingOpts, ctx);
  }

  @ToolHook.Did('execute', { priority: 1000 })
  _toolDidExecute(ctx: unknown): void {
    if (this.tracingEnabled) onToolDidExecute(this.tracingOpts, ctx);
  }

  @ToolHook.Will('validateOutput', { priority: -1000 })
  _toolWillValidateOut(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillValidateOutput(ctx);
  }

  @ToolHook.Will('applyUI', { priority: -1000 })
  _toolWillApplyUI(ctx: unknown): void {
    if (this.tracingEnabled) onToolWillApplyUI(ctx);
  }

  @ToolHook.Did('finalize', { priority: 1000 })
  _toolDidFinalize(ctx: unknown): void {
    if (this.tracingEnabled) onToolDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Resource Read Flow — resources:read-resource
  // ═══════════════════════════════════════════════════════════════════════════

  @ResourceHook.Will('parseInput', { priority: -1000 })
  _resourceWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onResourceWillParse(this.tracingOpts, ctx);
  }

  @ResourceHook.Will('findResource', { priority: -1000 })
  _resourceWillFind(ctx: unknown): void {
    if (this.tracingEnabled) onResourceWillFind(ctx);
  }

  @ResourceHook.Will('checkEntryAuthorities', { priority: -1000 })
  _resourceWillCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryWillCheckAuthorities(ctx);
  }

  @ResourceHook.Did('checkEntryAuthorities', { priority: 1000 })
  _resourceDidCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryDidCheckAuthorities(ctx);
  }

  @ResourceHook.Will('execute', { priority: -1000 })
  _resourceWillExecute(ctx: unknown): void {
    if (this.tracingEnabled) onResourceWillExecute(this.tracingOpts, ctx);
  }

  @ResourceHook.Did('execute', { priority: 1000 })
  _resourceDidExecute(ctx: unknown): void {
    if (this.tracingEnabled) onResourceDidExecute(ctx);
  }

  @ResourceHook.Did('finalize', { priority: 1000 })
  _resourceDidFinalize(ctx: unknown): void {
    if (this.tracingEnabled) onResourceDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Prompt Flow — prompts:get-prompt
  // ═══════════════════════════════════════════════════════════════════════════

  @PromptHook.Will('parseInput', { priority: -1000 })
  _promptWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onPromptWillParse(this.tracingOpts, ctx);
  }

  @PromptHook.Will('findPrompt', { priority: -1000 })
  _promptWillFind(ctx: unknown): void {
    if (this.tracingEnabled) onPromptWillFind(ctx);
  }

  @PromptHook.Will('checkEntryAuthorities', { priority: -1000 })
  _promptWillCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryWillCheckAuthorities(ctx);
  }

  @PromptHook.Did('checkEntryAuthorities', { priority: 1000 })
  _promptDidCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryDidCheckAuthorities(ctx);
  }

  @PromptHook.Will('execute', { priority: -1000 })
  _promptWillExecute(ctx: unknown): void {
    if (this.tracingEnabled) onPromptWillExecute(this.tracingOpts, ctx);
  }

  @PromptHook.Did('execute', { priority: 1000 })
  _promptDidExecute(ctx: unknown): void {
    if (this.tracingEnabled) onPromptDidExecute(ctx);
  }

  @PromptHook.Did('finalize', { priority: 1000 })
  _promptDidFinalize(ctx: unknown): void {
    if (this.tracingEnabled) onPromptDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Call Flow — agents:call-agent
  // ═══════════════════════════════════════════════════════════════════════════

  @AgentCallHook.Will('parseInput', { priority: -1000 })
  _agentWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onAgentWillParse(this.tracingOpts, ctx);
  }

  @AgentCallHook.Will('findAgent', { priority: -1000 })
  _agentWillFind(ctx: unknown): void {
    if (this.tracingEnabled) onAgentWillFind(ctx);
  }

  @AgentCallHook.Will('checkEntryAuthorities', { priority: -1000 })
  _agentWillCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryWillCheckAuthorities(ctx);
  }

  @AgentCallHook.Did('checkEntryAuthorities', { priority: 1000 })
  _agentDidCheckAuthorities(ctx: unknown): void {
    if (this.tracingEnabled) onEntryDidCheckAuthorities(ctx);
  }

  @AgentCallHook.Will('execute', { priority: -1000 })
  _agentWillExecute(ctx: unknown): void {
    if (this.tracingEnabled) onAgentWillExecute(this.tracingOpts, ctx);
  }

  @AgentCallHook.Did('execute', { priority: 1000 })
  _agentDidExecute(ctx: unknown): void {
    if (this.tracingEnabled) onAgentDidExecute(ctx);
  }

  @AgentCallHook.Did('finalize', { priority: 1000 })
  _agentDidFinalize(ctx: unknown): void {
    if (this.tracingEnabled) onAgentDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // List Operations — tools:list-tools, resources:list-resources, etc.
  // ═══════════════════════════════════════════════════════════════════════════

  @ListToolsHook.Will('parseInput', { priority: -1000 })
  _listToolsWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('tools/list', this.tracingOpts, ctx);
  }

  @ListToolsHook.Did('findTools', { priority: 1000 })
  _listToolsDidFind(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('findTools', ctx);
  }

  @ListToolsHook.Did('filterByAuthorities', { priority: 1000 })
  _listToolsDidFilter(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('filterByAuthorities', ctx);
  }

  @ListToolsHook.Did('parseTools', { priority: 1000 })
  _listToolsDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @ListResourcesHook.Will('parseInput', { priority: -1000 })
  _listResourcesWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('resources/list', this.tracingOpts, ctx);
  }

  @ListResourcesHook.Did('filterByAuthorities', { priority: 1000 })
  _listResourcesDidFilter(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('filterByAuthorities', ctx);
  }

  @ListResourcesHook.Did('parseResources', { priority: 1000 })
  _listResourcesDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @ListResourceTemplatesHook.Will('parseInput', { priority: -1000 })
  _listTemplatesWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('resources/listTemplates', this.tracingOpts, ctx);
  }

  @ListResourceTemplatesHook.Did('filterByAuthorities', { priority: 1000 })
  _listTemplatesDidFilter(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('filterByAuthorities', ctx);
  }

  @ListResourceTemplatesHook.Did('parseTemplates', { priority: 1000 })
  _listTemplatesDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @ListPromptsHook.Will('parseInput', { priority: -1000 })
  _listPromptsWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('prompts/list', this.tracingOpts, ctx);
  }

  @ListPromptsHook.Did('filterByAuthorities', { priority: 1000 })
  _listPromptsDidFilter(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('filterByAuthorities', ctx);
  }

  @ListPromptsHook.Did('parsePrompts', { priority: 1000 })
  _listPromptsDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Skills — skills:search, skills:load
  // ═══════════════════════════════════════════════════════════════════════════

  @SkillSearchHook.Will('parseInput', { priority: -1000 })
  _skillSearchWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('skills/search', this.tracingOpts, ctx);
  }

  @SkillSearchHook.Did('finalize', { priority: 1000 })
  _skillSearchDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @SkillLoadHook.Will('parseInput', { priority: -1000 })
  _skillLoadWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('skills/load', this.tracingOpts, ctx);
  }

  @SkillLoadHook.Will('loadSkills', { priority: -1000 })
  _skillLoadStage(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowStage('loadSkills', ctx);
  }

  @SkillLoadHook.Did('finalize', { priority: 1000 })
  _skillLoadDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Completion — completion:complete
  // ═══════════════════════════════════════════════════════════════════════════

  @CompletionHook.Will('parseInput', { priority: -1000 })
  _completionWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('completion/complete', this.tracingOpts, ctx);
  }

  @CompletionHook.Did('finalize', { priority: 1000 })
  _completionDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Transport: Legacy SSE — handle:legacy-sse
  // ═══════════════════════════════════════════════════════════════════════════

  @LegacySseHook.Will('parseInput', { priority: -1000 })
  _sseWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onTransportWillStart('legacy-sse', this.tracingOpts, ctx);
  }

  @LegacySseHook.Did('router', { priority: 1000 })
  _sseDidRoute(ctx: unknown): void {
    if (this.tracingEnabled) onTransportDidRoute(ctx);
  }

  @LegacySseHook.Did('onInitialize', { priority: 1000 })
  _sseDidInit(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onInitialize', ctx);
  }

  @LegacySseHook.Did('onMessage', { priority: 1000 })
  _sseDidMsg(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onMessage', ctx);
  }

  @LegacySseHook.Did('onElicitResult', { priority: 1000 })
  _sseDidElicit(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onElicitResult', ctx);
  }

  @LegacySseHook.Did('cleanup', { priority: 1000 })
  _sseDidCleanup(ctx: unknown): void {
    if (this.tracingEnabled) onTransportDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Transport: Streamable HTTP — handle:streamable-http
  // ═══════════════════════════════════════════════════════════════════════════

  @StreamableHttpHook.Will('parseInput', { priority: -1000 })
  _shttpWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onTransportWillStart('streamable-http', this.tracingOpts, ctx);
  }

  @StreamableHttpHook.Did('router', { priority: 1000 })
  _shttpDidRoute(ctx: unknown): void {
    if (this.tracingEnabled) onTransportDidRoute(ctx);
  }

  @StreamableHttpHook.Did('onInitialize', { priority: 1000 })
  _shttpDidInit(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onInitialize', ctx);
  }

  @StreamableHttpHook.Did('onMessage', { priority: 1000 })
  _shttpDidMsg(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onMessage', ctx);
  }

  @StreamableHttpHook.Did('onElicitResult', { priority: 1000 })
  _shttpDidElicit(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onElicitResult', ctx);
  }

  @StreamableHttpHook.Did('onSseListener', { priority: 1000 })
  _shttpDidSse(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onSseListener', ctx);
  }

  @StreamableHttpHook.Did('onExtApps', { priority: 1000 })
  _shttpDidExtApps(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('onExtApps', ctx);
  }

  @StreamableHttpHook.Did('cleanup', { priority: 1000 })
  _shttpDidCleanup(ctx: unknown): void {
    if (this.tracingEnabled) onTransportDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Transport: Stateless HTTP — handle:stateless-http
  // ═══════════════════════════════════════════════════════════════════════════

  @StatelessHttpHook.Will('parseInput', { priority: -1000 })
  _slhttpWillParse(ctx: unknown): void {
    if (this.tracingEnabled) onTransportWillStart('stateless-http', this.tracingOpts, ctx);
  }

  @StatelessHttpHook.Did('handleRequest', { priority: 1000 })
  _slhttpDidHandle(ctx: unknown): void {
    if (this.tracingEnabled) onTransportStage('handleRequest', ctx);
  }

  @StatelessHttpHook.Did('cleanup', { priority: 1000 })
  _slhttpDidCleanup(ctx: unknown): void {
    if (this.tracingEnabled) onTransportDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth: Verify — auth:verify
  // ═══════════════════════════════════════════════════════════════════════════

  @AuthVerifyHook.Will('parseInput', { priority: -1000 })
  _authVerifyWill(ctx: unknown): void {
    if (this.tracingEnabled) onAuthWillStart('auth:verify', this.tracingOpts, ctx);
  }

  @AuthVerifyHook.Did('determineAuthMode', { priority: 1000 })
  _authVerifyDidMode(ctx: unknown): void {
    if (this.tracingEnabled) onAuthDidDetermineMode(ctx);
  }

  @AuthVerifyHook.Did('verifyToken', { priority: 1000 })
  _authVerifyDidToken(ctx: unknown): void {
    if (this.tracingEnabled) onAuthStage('verifyToken', ctx);
  }

  @AuthVerifyHook.Did('buildAuthorization', { priority: 1000 })
  _authVerifyDidBuild(ctx: unknown): void {
    if (this.tracingEnabled) onAuthDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth: Session Verify — session:verify
  // ═══════════════════════════════════════════════════════════════════════════

  @SessionVerifyHook.Will('parseInput', { priority: -1000 })
  _sessionVerifyWill(ctx: unknown): void {
    if (this.tracingEnabled) onAuthWillStart('session:verify', this.tracingOpts, ctx);
  }

  @SessionVerifyHook.Did('verifyIfJwt', { priority: 1000 })
  _sessionVerifyDidJwt(ctx: unknown): void {
    if (this.tracingEnabled) onAuthStage('verifyIfJwt', ctx);
  }

  @SessionVerifyHook.Did('buildAuthorizedOutput', { priority: 1000 })
  _sessionVerifyDidBuild(ctx: unknown): void {
    if (this.tracingEnabled) onAuthDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OAuth Flows
  // ═══════════════════════════════════════════════════════════════════════════

  @OAuthTokenHook.Will('parseInput', { priority: -1000 })
  _oauthTokenWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('oauth/token', this.tracingOpts, ctx);
  }

  @OAuthTokenHook.Did('buildTokenResponse', { priority: 1000 })
  _oauthTokenDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @OAuthAuthorizeHook.Will('parseInput', { priority: -1000 })
  _oauthAuthzWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('oauth/authorize', this.tracingOpts, ctx);
  }

  @OAuthAuthorizeHook.Did('buildAuthorizeOutput', { priority: 1000 })
  _oauthAuthzDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @OAuthCallbackHook.Will('parseInput', { priority: -1000 })
  _oauthCallbackWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('oauth/callback', this.tracingOpts, ctx);
  }

  @OAuthCallbackHook.Did('redirectToClient', { priority: 1000 })
  _oauthCallbackDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @OAuthProviderCallbackHook.Will('parseInput', { priority: -1000 })
  _oauthProviderWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('oauth/provider-callback', this.tracingOpts, ctx);
  }

  @OAuthProviderCallbackHook.Did('handleNextProviderOrComplete', { priority: 1000 })
  _oauthProviderDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @OAuthRegisterHook.Will('parseInput', { priority: -1000 })
  _oauthRegisterWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('oauth/register', this.tracingOpts, ctx);
  }

  @OAuthRegisterHook.Did('respondRegistration', { priority: 1000 })
  _oauthRegisterDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Elicitation Flows
  // ═══════════════════════════════════════════════════════════════════════════

  @ElicitRequestHook.Will('parseInput', { priority: -1000 })
  _elicitReqWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('elicitation/request', this.tracingOpts, ctx);
  }

  @ElicitRequestHook.Did('finalize', { priority: 1000 })
  _elicitReqDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @ElicitResultHook.Will('parseInput', { priority: -1000 })
  _elicitResWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('elicitation/result', this.tracingOpts, ctx);
  }

  @ElicitResultHook.Did('finalize', { priority: 1000 })
  _elicitResDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Resource Subscriptions
  // ═══════════════════════════════════════════════════════════════════════════

  @SubscribeResourceHook.Will('parseInput', { priority: -1000 })
  _subscribeWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('resources/subscribe', this.tracingOpts, ctx);
  }

  @SubscribeResourceHook.Did('finalize', { priority: 1000 })
  _subscribeDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @UnsubscribeResourceHook.Will('parseInput', { priority: -1000 })
  _unsubscribeWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('resources/unsubscribe', this.tracingOpts, ctx);
  }

  @UnsubscribeResourceHook.Did('finalize', { priority: 1000 })
  _unsubscribeDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Skills HTTP — llm.txt, llm-full.txt, API
  // ═══════════════════════════════════════════════════════════════════════════

  @SkillsHttpLlmTxtHook.Will('checkEnabled', { priority: -1000 })
  _skillsLlmTxtWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('skills-http/llm-txt', this.tracingOpts, ctx);
  }

  @SkillsHttpLlmTxtHook.Did('generateContent', { priority: 1000 })
  _skillsLlmTxtDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @SkillsHttpLlmFullTxtHook.Will('checkEnabled', { priority: -1000 })
  _skillsLlmFullTxtWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('skills-http/llm-full-txt', this.tracingOpts, ctx);
  }

  @SkillsHttpLlmFullTxtHook.Did('generateContent', { priority: 1000 })
  _skillsLlmFullTxtDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @SkillsHttpApiHook.Will('checkEnabled', { priority: -1000 })
  _skillsApiWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('skills-http/api', this.tracingOpts, ctx);
  }

  @SkillsHttpApiHook.Did('handleRequest', { priority: 1000 })
  _skillsApiDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Well-Known Endpoints — JWKS, OAuth Server, PRM
  // ═══════════════════════════════════════════════════════════════════════════

  @WellKnownJwksHook.Will('parseInput', { priority: -1000 })
  _jwksWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('well-known/jwks', this.tracingOpts, ctx);
  }

  @WellKnownJwksHook.Did('collectData', { priority: 1000 })
  _jwksDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @WellKnownOAuthServerHook.Will('parseInput', { priority: -1000 })
  _oauthServerWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('well-known/oauth-server', this.tracingOpts, ctx);
  }

  @WellKnownOAuthServerHook.Did('collectData', { priority: 1000 })
  _oauthServerDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  @WellKnownPrmHook.Will('parseInput', { priority: -1000 })
  _prmWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('well-known/prm', this.tracingOpts, ctx);
  }

  @WellKnownPrmHook.Did('collectData', { priority: 1000 })
  _prmDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Logging — set-level
  // ═══════════════════════════════════════════════════════════════════════════

  @LoggingSetLevelHook.Will('parseInput', { priority: -1000 })
  _setLevelWill(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowWillStart('logging/set-level', this.tracingOpts, ctx);
  }

  @LoggingSetLevelHook.Did('finalize', { priority: 1000 })
  _setLevelDone(ctx: unknown): void {
    if (this.tracingEnabled) onGenericFlowDidFinalize(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fetch Instrumentation (wraps ctx.fetch with OTel client spans)
  // ═══════════════════════════════════════════════════════════════════════════

  @ToolHook.Did('createToolCallContext', { priority: 999 })
  _toolDidCreateCtxFetch(ctx: unknown): void {
    if (this.tracingEnabled) wrapContextFetch(this.tracingOpts, ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Metadata Enrichment (iterations, duration on span)
  // ═══════════════════════════════════════════════════════════════════════════

  @AgentCallHook.Did('execute', { priority: 999 })
  _agentDidExecuteMeta(ctx: unknown): void {
    if (this.tracingEnabled) onAgentDidExecuteEnrich(ctx);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Startup Report (public method)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit startup telemetry report.
   * Call after scope.initialize() completes with component counts.
   */
  reportStartupTelemetry(data: StartupTelemetryData): void {
    if (this.options.tracing === false) return;
    reportStartup(data);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dynamic Providers
  // ═══════════════════════════════════════════════════════════════════════════

  static override dynamicProviders = (input: ObservabilityPluginOptionsInput): ProviderType[] => {
    const options = resolveOptions(input);
    const providers: ProviderType[] = [];

    if (options.tracing !== false) {
      providers.push({
        name: 'observability:tracer',
        provide: OTEL_TRACER,
        useValue: trace.getTracer('@frontmcp/observability'),
      });
      providers.push({
        name: 'observability:config',
        provide: OTEL_CONFIG,
        useValue: options.tracing,
      });

      // TelemetryAccessor — CONTEXT-scoped, provides `this.telemetry` to tools.
      // Receives the full FrontMcpContext so it can read the active span
      // via ctx.get(ACTIVE_SPAN_KEY) for addEvent/setAttributes.
      providers.push({
        name: 'observability:telemetry-accessor',
        provide: TELEMETRY_ACCESSOR,
        scope: ProviderScope.CONTEXT,
        inject: () => [FRONTMCP_CONTEXT] as const,
        useFactory: (ctx: any) => new TelemetryAccessor(ctx),
      });
    }

    if (options.logging !== false) {
      const loggingOpts = options.logging as ObservabilityLoggingOptions;
      const sinks = createSinks(loggingOpts.sinks);
      const transport = new StructuredLogTransport(
        sinks,
        {
          redactFields: loggingOpts.redactFields,
          includeStacks: loggingOpts.includeStacks,
          staticFields: loggingOpts.staticFields,
        },
        undefined,
      );
      providers.push({
        name: 'observability:structured-log-transport',
        provide: StructuredLogTransport,
        useValue: transport,
      });
    }

    if (options.requestLogs !== false) {
      const requestLogOpts = options.requestLogs as RequestLogCollectorOptions;
      providers.push({
        name: 'observability:request-log-collector',
        provide: REQUEST_LOG_COLLECTOR,
        scope: ProviderScope.CONTEXT,
        inject: () => [FRONTMCP_CONTEXT] as const,
        useFactory: (ctx: {
          requestId: string;
          traceContext: { traceId: string };
          scopeId: string;
          sessionId: string;
        }) => {
          return new RequestLogCollector(
            {
              requestId: ctx.requestId,
              traceId: ctx.traceContext.traceId,
              sessionIdHash: sessionTracingId(ctx.sessionId).slice(0, 12),
              scopeId: ctx.scopeId,
            },
            requestLogOpts,
          );
        },
      });
    }

    return providers;
  };
}

function resolveOptions(input: ObservabilityPluginOptionsInput): ObservabilityPluginOptions {
  return {
    tracing: resolveTracingOptions(input.tracing),
    logging: resolveLoggingOptions(input.logging),
    requestLogs: resolveRequestLogOptions(input.requestLogs),
  };
}

function resolveTracingOptions(input?: boolean | TracingOptions): TracingOptions | false {
  if (input === false) return false;
  if (input === true || input === undefined) return DEFAULT_TRACING;
  return { ...DEFAULT_TRACING, ...input };
}

function resolveLoggingOptions(input?: boolean | ObservabilityLoggingOptions): ObservabilityLoggingOptions | false {
  if (input === false || input === undefined) return false;
  if (input === true) return {};
  return input;
}

function resolveRequestLogOptions(input?: boolean | RequestLogCollectorOptions): RequestLogCollectorOptions | false {
  if (input === false || input === undefined) return false;
  if (input === true) return {};
  return input;
}
