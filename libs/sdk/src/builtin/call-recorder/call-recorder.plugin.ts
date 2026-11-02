import { McpError as ProtocolMcpError, type CallToolResult } from '@frontmcp/protocol';
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
import { headerValueForLog, isCredentialName, isSessionIdName } from '../../scope/flows/request-log.redaction';
import { toolCallErrorResult } from '../../transport/mcp-handlers/call-tool-error.utils';
import { toReportedError, toSdkMcpError } from '../../transport/mcp-handlers/mcp-error.utils';
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

/** Answers a tool error as a production server does, with no stack and no internal message. */
const productionErrorHandler = new ErrorHandler({ isDevelopment: false });

const REDACTED = '[REDACTED]';
/** Where `@frontmcp/plugin-result-handles` puts a folded answer's handle, which its encryption keys derive from. */
const RESULT_HANDLE_META_KEY = 'frontmcp/result-handle';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const REMEMBERED_HANDLES = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestParamsOf(rawInput: unknown): Record<string, unknown> {
  const request = isRecord(rawInput) ? rawInput['request'] : undefined;
  const params = isRecord(request) ? request['params'] : undefined;
  return isRecord(params) ? params : {};
}

function resultHandleOf(answer: unknown): string | undefined {
  const meta = isRecord(answer) && isRecord(answer['_meta']) ? answer['_meta'][RESULT_HANDLE_META_KEY] : undefined;
  const handle = isRecord(meta) ? meta['handle'] : undefined;
  return typeof handle === 'string' && handle.length > 0 ? handle : undefined;
}

function textOf(answer: CallToolResult): string {
  return answer.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}

/** The JSON-RPC error a client gets: its code, and a public error's message without the `MCP error <code>: ` prefix. */
function jsonRpcErrorOf(error: unknown): CallRecordError {
  const { code, message } = toSdkMcpError(error);
  const reported = toReportedError(error);
  const isPublic = reported instanceof ProtocolMcpError || reported.isPublic;
  return isPublic ? { code, message: message.replace(/^MCP error -?\d+: /, '') } : { code };
}

/** What the client saw: a tool error answer's `_meta.code` and text, or the JSON-RPC error. */
function recordedErrorOf(method: RecordedMethod, error: Error): CallRecordError {
  if (method !== 'tools/call') return jsonRpcErrorOf(error);
  let answer: CallToolResult;
  try {
    answer = toolCallErrorResult(error, { errorHandler: productionErrorHandler, toolName: '' });
  } catch {
    return jsonRpcErrorOf(error);
  }
  const reported = toMcpError(error);
  const code = answer._meta?.['code'];
  return {
    code: typeof code === 'string' ? code : reported.code,
    ...(reported.isPublic && { message: textOf(answer) }),
  };
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
  /** The handles of folded answers recorded lately, so a later call that reads one does not record it either. */
  private readonly resultHandles = new Set<string>();

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

  /** A task-augmented call is recorded by the task's own run, which answers; the run creating it answers a handle. */
  @ToolHook.Will('parseInput', { priority: -1000 })
  openToolCall(flow: FlowCtxOf<'tools:call-tool'>): void {
    const createsTask = requestParamsOf(flow.rawInput)['task'] !== undefined;
    if (flow.isClientCall() && !createsTask) this.open(flow, 'tools/call');
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
      writer.write(this.lineOf(run, call));
    } catch (error) {
      writer.reportFailure(error);
    }
  }

  /** The record as a JSONL line, with every result handle it holds redacted. */
  private lineOf(run: RecordedRun, call: OpenCall): string {
    const handle = run.error ? undefined : resultHandleOf(run.state.output);
    if (handle) this.rememberResultHandle(handle);
    let line = JSON.stringify(this.recordOf(run, call));
    if (handle) line = line.split(handle).join(REDACTED);
    if (this.resultHandles.size > 0) {
      line = line.replace(UUID, (id) => (this.resultHandles.has(id) ? REDACTED : id));
    }
    return `${line}\n`;
  }

  private rememberResultHandle(handle: string): void {
    this.resultHandles.delete(handle);
    this.resultHandles.add(handle);
    if (this.resultHandles.size <= REMEMBERED_HANDLES) return;
    const [oldest] = this.resultHandles;
    this.resultHandles.delete(oldest);
  }

  private recordOf(run: RecordedRun, { method, startedAt }: OpenCall): CallRecord {
    const params = requestParamsOf(run.rawInput);
    const input = params['arguments'];
    const { sessionId, clientInfo } = run.request;
    return {
      v: CALL_RECORD_VERSION,
      at: new Date(startedAt).toISOString(),
      method,
      name: String(method === 'resources/read' ? this.redact(String(params['uri'])) : params['name']),
      ...(isRecord(input) && { input: this.redact(input) as Record<string, unknown> }),
      ...(run.error
        ? { error: this.redactError(recordedErrorOf(method, run.error)) }
        : { answer: this.redact(run.state.output) }),
      durationMs: Date.now() - startedAt,
      ...(sessionId && { session: String(headerValueForLog('mcp-session-id', sessionId)) }),
      ...(clientInfo && { client: { name: clientInfo.name, version: clientInfo.version } }),
    };
  }

  private redactError(error: CallRecordError): CallRecordError {
    return error.message === undefined ? error : { ...error, message: String(this.redact(error.message)) };
  }

  private redact(value: unknown): unknown {
    return redactJson(value, (key) => {
      const field = key.toLowerCase();
      return this.redacted.has(field) || (!this.kept.has(field) && (isCredentialName(key) || isSessionIdName(key)));
    });
  }
}
