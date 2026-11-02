import { redactJson } from '@frontmcp/utils';

import {
  DynamicPlugin,
  FlowHooksOf,
  FrontMcpLogger,
  Plugin,
  ProviderScope,
  type FlowCtxOf,
  type FlowRequestInfo,
  type ProviderType,
} from '../../common';
import { ErrorHandler, toMcpError } from '../../errors';
import { headerValueForLog, isCredentialName } from '../../scope/flows/request-log.redaction';
import { toolCallErrorResult } from '../../transport/mcp-handlers/call-tool-error.utils';
import { toSdkMcpError } from '../../transport/mcp-handlers/mcp-error.utils';
import { CALL_RECORD_VERSION, type CallRecord, type CallRecordError, type RecordedMethod } from './call-record';
import { CallRecordWriter } from './call-record.writer';
import {
  parseCallRecorderOptions,
  type CallRecorderPluginOptions,
  type CallRecorderPluginOptionsInput,
} from './call-recorder.options';

const ToolHook = FlowHooksOf('tools:call-tool');
const ResourceHook = FlowHooksOf('resources:read-resource');
const PromptHook = FlowHooksOf('prompts:get-prompt');

/** What the recorder reads of a tool, resource or prompt run. */
interface RecordedRun {
  readonly rawInput: unknown;
  readonly request: FlowRequestInfo;
  readonly error: Error | undefined;
  readonly state: { readonly output?: unknown };
}

interface OpenCall {
  method: RecordedMethod;
  startedAt: number;
}

const quietErrorHandler = new ErrorHandler({});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestParamsOf(rawInput: unknown): Record<string, unknown> {
  const request = isRecord(rawInput) ? rawInput['request'] : undefined;
  const params = isRecord(request) ? request['params'] : undefined;
  return isRecord(params) ? params : {};
}

/** The code the client saw: a tool error answer's `_meta.code`, or the JSON-RPC error's code. */
function clientErrorCodeOf(method: RecordedMethod, error: Error): string | number {
  if (method !== 'tools/call') return toSdkMcpError(error).code;
  try {
    const code = toolCallErrorResult(error, { errorHandler: quietErrorHandler, toolName: '' })._meta?.['code'];
    return typeof code === 'string' ? code : toMcpError(error).code;
  } catch (thrown) {
    return toSdkMcpError(thrown).code;
  }
}

function recordedErrorOf(method: RecordedMethod, error: Error): CallRecordError {
  return { code: clientErrorCodeOf(method, error), message: toMcpError(error).getPublicMessage() };
}

/** Appends each call a client makes, with the answer or error it received, redacted, to JSONL for `replaySession()`. */
@Plugin({
  name: 'call-recorder',
  description: 'Records the calls clients make and the answers they receive, redacted, for replaySession()',
})
export default class CallRecorderPlugin extends DynamicPlugin<
  CallRecorderPluginOptions,
  CallRecorderPluginOptionsInput
> {
  options: CallRecorderPluginOptions;
  private readonly openCalls = new WeakMap<object, OpenCall>();
  private readonly redacted: Set<string>;
  private readonly kept: Set<string>;

  constructor(options: CallRecorderPluginOptionsInput = {}) {
    super();
    this.options = parseCallRecorderOptions(options);
    this.redacted = new Set(this.options.redactFields.map((field) => field.toLowerCase()));
    this.kept = new Set(this.options.keepFields.map((field) => field.toLowerCase()));
  }

  static override dynamicProviders = (input: CallRecorderPluginOptionsInput): ProviderType[] => {
    const options = parseCallRecorderOptions(input);
    return [
      {
        name: 'call-recorder:writer',
        provide: CallRecordWriter,
        scope: ProviderScope.GLOBAL,
        inject: () => [FrontMcpLogger] as const,
        useFactory: (logger: FrontMcpLogger) => new CallRecordWriter(options, logger.child('CallRecorder')),
      },
    ];
  };

  @ToolHook.Will('parseInput', { priority: -1000 })
  openToolCall(flow: FlowCtxOf<'tools:call-tool'>): void {
    if (flow.isClientCall()) this.open(flow, 'tools/call');
  }

  @ResourceHook.Will('parseInput', { priority: -1000 })
  openResourceRead(flow: object): void {
    this.open(flow, 'resources/read');
  }

  @PromptHook.Will('parseInput', { priority: -1000 })
  openPromptGet(flow: object): void {
    this.open(flow, 'prompts/get');
  }

  /** Once a stage has failed nothing later changes the outcome, so the call is recorded with its error. */
  @ToolHook.Finally('releaseSemaphore', { priority: 1000 })
  @ToolHook.Finally('releaseQuota', { priority: 1000 })
  @ToolHook.Finally('applyUI', { priority: 1000 })
  @ToolHook.Finally('finalize', { priority: 1000 })
  @ToolHook.Finally('fitAnswer', { priority: 1000 })
  @ToolHook.Finally('shapeAnswer', { priority: 1000 })
  @ResourceHook.Finally('finalize', { priority: 1000 })
  recordFailedCall(run: RecordedRun): void {
    if (run.error) this.record(run);
  }

  /** After the last answer stage, `state.output` is the answer the client receives. */
  @ToolHook.Finally('meterAnswer', { priority: 1000 })
  @ResourceHook.Finally('fitAnswer', { priority: 1000 })
  @PromptHook.Finally('finalize', { priority: 1000 })
  recordCall(run: RecordedRun): void {
    if (run.error || run.state.output !== undefined) this.record(run);
  }

  private open(flow: object, method: RecordedMethod): void {
    if (this.options.methods.includes(method)) this.openCalls.set(flow, { method, startedAt: Date.now() });
  }

  private record(run: RecordedRun): void {
    const call = this.openCalls.get(run);
    if (!call) return;
    this.openCalls.delete(run);
    const writer = this.get(CallRecordWriter);
    try {
      writer.write(this.recordOf(run, call));
    } catch (error) {
      writer.reportFailure(error);
    }
  }

  private recordOf(run: RecordedRun, { method, startedAt }: OpenCall): CallRecord {
    const params = requestParamsOf(run.rawInput);
    const input = params['arguments'];
    const { sessionId, clientInfo } = run.request;
    return {
      v: CALL_RECORD_VERSION,
      at: new Date(startedAt).toISOString(),
      method,
      name: String(method === 'resources/read' ? params['uri'] : params['name']),
      ...(isRecord(input) && { input: this.redact(input) as Record<string, unknown> }),
      ...(run.error ? { error: recordedErrorOf(method, run.error) } : { answer: this.redact(run.state.output) }),
      durationMs: Date.now() - startedAt,
      ...(sessionId && { session: String(headerValueForLog('mcp-session-id', sessionId)) }),
      ...(clientInfo && { client: { name: clientInfo.name, version: clientInfo.version } }),
    };
  }

  private redact(value: unknown): unknown {
    return redactJson(value, (key) => {
      const field = key.toLowerCase();
      return this.redacted.has(field) || (!this.kept.has(field) && isCredentialName(key));
    });
  }
}
