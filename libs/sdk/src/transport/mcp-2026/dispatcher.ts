/**
 * JSON-RPC dispatch for protocol 2026-07-28.
 *
 * Reuses the SAME `createMcpHandlers` set every other transport uses, so tools,
 * resources, prompts and completions behave identically across revisions —
 * only the envelope differs. What this layer adds is the 2026-specific
 * behaviour: method admission (removed methods now 404), the MRTR exchange,
 * and result decoration.
 */
import { MCP_2026_ERROR_CODES, MCP_2026_REMOVED_METHODS, McpError, type Implementation } from '@frontmcp/protocol';
import { sha256Hex } from '@frontmcp/utils';

import { type FrontMcpContext } from '../../context';
import { InputRequiredSignal, MissingClientCapabilityError } from '../../errors';
import { type Scope } from '../../scope';
import { type TaskRecord } from '../../task/task.types';
import { buildScopedServerOptions } from '../build-scoped-server-options';
import { createMcpHandlers } from '../mcp-handlers';
import { buildDiscoverResult } from './discover';
import { buildInputRequiredResult, MrtrExchange } from './mrtr';
import { type RequestNotificationSink } from './request-notifications';
import { computeRequestBinding, decodeRequestState, type RequestStateBinding } from './request-state';
import { type JsonRpcErrorPayload } from './request-validation';
import { decorateResult, orderListResult, resolveCacheScope } from './result-decorator';
import {
  buildCreateTaskResult,
  clientSupportsTasks,
  dispatchTasksMethod,
  resolveTaskOwner,
  TASKS_EXTENSION_ID,
  TASKS_EXTENSION_METHODS,
} from './tasks-extension';

export interface DispatchOptions {
  scope: Scope;
  /** The validated JSON-RPC request body. */
  body: Record<string, unknown>;
  /** Capabilities the client declared in this request's `_meta`. */
  clientCapabilities: Record<string, unknown>;
  /** Ambient request context, used to carry the MRTR exchange to `elicit()`. */
  frontmcpContext?: FrontMcpContext;
  /** Auth info forwarded to the shared handlers. */
  authInfo?: Record<string, unknown>;
  /** True when the caller is unauthenticated, which makes results publicly cacheable. */
  isAnonymous: boolean;
  signal?: AbortSignal;
  /** Lazily composed instructions for `server/discover`. */
  composeInstructions?: () => string | undefined;
  /** Collects `notifications/message` + `notifications/progress` for this request. */
  notificationSink?: RequestNotificationSink;
  /** OpenTelemetry context echoed back on the result (SEP-414). */
  traceContext?: Record<string, string>;
}

export type DispatchResult =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; status: number; error: JsonRpcErrorPayload };

/**
 * Requests that MAY return an `InputRequiredResult`.
 *
 * The spec enumerates these three and adds "Servers MUST NOT send
 * `InputRequiredResult` responses on any other client requests."
 */
export const MRTR_CAPABLE_METHODS = ['tools/call', 'prompts/get', 'resources/read'] as const;

/**
 * Identify the caller for `requestState` binding.
 *
 * Falls back to a fixed anonymous marker rather than a random value: public
 * servers must still be able to redeem their own state on the retry, and there
 * is no principal to separate anonymous callers by.
 */
export function resolvePrincipal(authInfo: Record<string, unknown> | undefined): string {
  const clientId = authInfo?.['clientId'];
  if (typeof clientId === 'string' && clientId.length > 0) return clientId;

  const token = authInfo?.['token'];
  // Hash the WHOLE token. A prefix would collide: every HS256 JWT starts with
  // the same base64url-encoded header, so truncating would map all such callers
  // onto one principal and let them redeem each other's `requestState`.
  if (typeof token === 'string' && token.length > 0) return `tok:${sha256Hex(token)}`;

  return 'anonymous';
}

/**
 * Identify the caller for TASK ownership.
 *
 * Stricter than {@link resolvePrincipal}: a public-mode server mints an
 * anonymous bootstrap token per request, which is a fine binding for a
 * short-lived `requestState` but must NOT be mistaken for an identity that can
 * own a durable task. Anonymous callers resolve to `'anonymous'` so task
 * creation is refused rather than pooled across unrelated users.
 */
export function resolveTaskPrincipal(authInfo: Record<string, unknown> | undefined, isAnonymous = false): string {
  // A public-mode server mints an anonymous session — complete with a synthetic
  // subject — for every unauthenticated caller. That subject is fine for binding
  // a short-lived `requestState`, but treating it as a task OWNER would pool
  // unrelated anonymous users into one task namespace, so it is rejected here.
  if (isAnonymous) return 'anonymous';

  const clientId = authInfo?.['clientId'];
  return typeof clientId === 'string' && clientId.length > 0 ? clientId : 'anonymous';
}

type TaskDecision = { kind: 'skip' } | { kind: 'create'; owner: string } | { kind: 'refuse'; reason: string };

/**
 * Decide whether this `tools/call` should be answered with a task handle.
 *
 * Three things must line up: the tool has to declare task support, the client
 * has to declare the extension, and the caller has to be identifiable (a task
 * outlives the request, and this revision has no session to scope it by).
 */
function shouldCreateTask(params: {
  scope: Scope;
  method: string;
  params: Record<string, unknown>;
  clientCapabilities: Record<string, unknown>;
  authInfo: Record<string, unknown> | undefined;
  isAnonymous: boolean;
}): TaskDecision {
  if (params.method !== 'tools/call') return { kind: 'skip' };
  if (!params.scope.taskStore) return { kind: 'skip' };

  const toolName = params.params['name'];
  if (typeof toolName !== 'string') return { kind: 'skip' };

  const tool = params.scope.tools
    .getTools(true)
    .find((entry) => entry.fullName === toolName || entry.metadata.name === toolName);
  const taskSupport = tool?.metadata.execution?.taskSupport;
  if (taskSupport !== 'required' && taskSupport !== 'optional') return { kind: 'skip' };

  if (!clientSupportsTasks(params.clientCapabilities)) {
    // A tool that can ONLY run as a task cannot serve a client that has no way
    // to poll for the outcome, so say so rather than silently blocking.
    if (taskSupport === 'required') {
      return {
        kind: 'refuse',
        reason: `Tool "${toolName}" runs as a task; declare the ${TASKS_EXTENSION_ID} extension in clientCapabilities`,
      };
    }
    return { kind: 'skip' };
  }

  const ownership = resolveTaskOwner(resolveTaskPrincipal(params.authInfo, params.isAnonymous));
  if (!ownership.ok) return { kind: 'refuse', reason: ownership.reason };

  return { kind: 'create', owner: ownership.owner };
}

/**
 * Re-run a task that `tasks/update` moved back to `working`.
 *
 * The accumulated `inputResponses` are replayed into the tool through a fresh
 * MRTR exchange, so a tool that asked for input resolves it inline this time —
 * exactly the replay model the request-scoped MRTR path uses.
 */
async function resumeTask(params: {
  scope: Scope;
  record: TaskRecord;
  authInfo: Record<string, unknown>;
  clientCapabilities: Record<string, unknown>;
  frontmcpContext?: FrontMcpContext;
}): Promise<void> {
  const { scope, record, authInfo, clientCapabilities, frontmcpContext } = params;
  const registry = scope.tasks;
  const runner = registry?.runner;
  if (!runner) {
    scope.logger.warn('mcp-2026: cannot resume task, no runner configured', { taskId: record.taskId });
    return;
  }

  // The resumed run needs its own MRTR exchange, seeded with everything the
  // client has answered so far. Without it `elicit()` would fall through to the
  // legacy fallback path and ask again instead of consuming the answer that
  // `tasks/update` just supplied.
  frontmcpContext?.setMrtrExchange(
    new MrtrExchange({
      carriedResponses: record.inputResponses ?? {},
      clientCapabilities,
      binding: {
        principal: resolveTaskPrincipal(authInfo),
        binding: computeRequestBinding('tasks/resume', { name: record.taskId }),
      },
    }),
  );

  await runner.run(record, {
    cleanedRequestParams: record.request.params,
    ctx: { authInfo },
  });
}

/** Read the JSON-RPC method literal a handler's request schema is bound to. */
function methodOfSchema(schema: unknown): string | undefined {
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
  const method = shape?.['method'] as { value?: unknown; _def?: { values?: unknown[] } } | undefined;
  if (typeof method?.value === 'string') return method.value;
  const values = method?._def?.values;
  return Array.isArray(values) && typeof values[0] === 'string' ? values[0] : undefined;
}

/**
 * Map a thrown error onto a JSON-RPC error payload.
 *
 * The one substantive change from earlier revisions is resource-not-found:
 * `-32002` was retired in favour of `-32602` to align with JSON-RPC. Because
 * the shared handlers still raise the old code (they serve legacy clients too),
 * the translation happens here rather than at the source.
 */
export function toJsonRpcError(error: unknown): { status: number; error: JsonRpcErrorPayload } {
  if (error instanceof MissingClientCapabilityError) {
    return {
      status: 400,
      error: {
        code: MCP_2026_ERROR_CODES.missingRequiredClientCapability,
        message: error.getPublicMessage(),
        data: { requiredCapabilities: error.requiredCapabilities },
      },
    };
  }

  const withJsonRpc = error as { toJsonRpcError?: () => JsonRpcErrorPayload } | undefined;
  let payload: JsonRpcErrorPayload;

  if (typeof withJsonRpc?.toJsonRpcError === 'function') {
    payload = withJsonRpc.toJsonRpcError();
  } else if (error instanceof McpError) {
    payload = { code: error.code, message: error.message, data: (error as { data?: unknown }).data };
  } else {
    payload = { code: -32603, message: error instanceof Error ? error.message : String(error) };
  }

  // Retired in 2026-07-28: resource-not-found is now Invalid Params.
  if (payload.code === -32002) payload = { ...payload, code: -32602 };

  return { status: 200, error: payload };
}

/**
 * Dispatch one 2026-07-28 JSON-RPC request.
 *
 * `subscriptions/listen` is NOT handled here — it needs to own the HTTP
 * response as a stream, so the flow handles it before calling in.
 */
export async function dispatch2026(options: DispatchOptions): Promise<DispatchResult> {
  const {
    scope,
    body,
    clientCapabilities,
    frontmcpContext,
    authInfo,
    isAnonymous,
    signal,
    composeInstructions,
    notificationSink,
    traceContext,
  } = options;

  const method = body['method'] as string;
  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
  const cacheScope = resolveCacheScope(isAnonymous);
  const serverInfo = scope.metadata.info as Implementation;
  const decorate = (raw: Record<string, unknown>): Record<string, unknown> =>
    decorateResult(orderListResult(method, raw), { method, serverInfo, cacheScope, traceContext });

  if ((MCP_2026_REMOVED_METHODS as readonly string[]).includes(method)) {
    return {
      kind: 'error',
      status: 404,
      error: { code: -32601, message: `Method not found: ${method} was removed in protocol 2026-07-28` },
    };
  }

  // ── io.modelcontextprotocol/tasks extension ────────────────────────────────
  if (TASKS_EXTENSION_METHODS.includes(method)) {
    if (!clientSupportsTasks(clientCapabilities)) {
      return {
        kind: 'error',
        status: 400,
        error: {
          code: MCP_2026_ERROR_CODES.missingRequiredClientCapability,
          message: `${method} requires the ${TASKS_EXTENSION_ID} extension`,
          data: { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
        },
      };
    }

    const ownership = resolveTaskOwner(resolveTaskPrincipal(authInfo, isAnonymous));
    if (!ownership.ok) {
      return { kind: 'error', status: 200, error: { code: -32602, message: ownership.reason } };
    }

    const outcome = await dispatchTasksMethod({
      scope,
      method,
      params,
      owner: ownership.owner,
      resume: (record) =>
        resumeTask({
          scope,
          record,
          authInfo: { ...(authInfo ?? {}), sessionId: ownership.owner },
          clientCapabilities,
          frontmcpContext,
        }),
    });

    return outcome.kind === 'result' ? { kind: 'result', result: decorate(outcome.result) } : outcome;
  }

  if (method === 'server/discover') {
    return {
      kind: 'result',
      result: decorate(buildDiscoverResult(scope, composeInstructions?.()) as Record<string, unknown>),
    };
  }

  const serverOptions = buildScopedServerOptions(scope, composeInstructions?.() ?? '');
  const handlers = createMcpHandlers({ scope, serverOptions, composeInstructions });

  const handler = handlers.find((entry) => methodOfSchema(entry.requestSchema) === method);
  if (!handler) {
    return { kind: 'error', status: 404, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  // Every request carries its own MRTR exchange: capabilities are per-request in
  // this revision, so an exchange must never outlive the request that made it.
  //
  // `requestState` is attacker-controlled — it round-trips through the client —
  // so it is verified against the caller's principal and this exact request
  // before its contents are trusted. A blob that fails verification is treated
  // as "no prior answers", which restarts the exchange rather than failing a
  // caller whose state merely expired.
  const binding: RequestStateBinding = {
    principal: resolvePrincipal(authInfo),
    binding: computeRequestBinding(method, params),
  };
  const carried = decodeRequestState(params['requestState'], binding);
  if (!carried.ok && carried.reason !== 'absent') {
    scope.logger.warn('mcp-2026: rejected requestState', { method, reason: carried.reason });
  }

  const exchange = new MrtrExchange({
    inputResponses: params['inputResponses'] as Record<string, Record<string, unknown>> | undefined,
    carriedResponses: carried.ok ? carried.responses : {},
    clientCapabilities,
    binding,
  });
  frontmcpContext?.setMrtrExchange(exchange);
  if (notificationSink) frontmcpContext?.setRequestNotificationSink(notificationSink);

  // Tasks are no longer opted into per request (`params.task` is gone). A server
  // MAY hand back a task handle whenever the work is long-running, gated only on
  // the CLIENT declaring the extension. Reuse the existing task-creation stage by
  // supplying the augmentation it still keys off internally.
  const taskDecision = shouldCreateTask({ scope, method, params, clientCapabilities, authInfo, isAnonymous });
  if (taskDecision.kind === 'refuse') {
    return { kind: 'error', status: 200, error: { code: -32602, message: taskDecision.reason } };
  }

  const dispatchBody = taskDecision.kind === 'create' ? { ...body, params: { ...params, task: {} } } : body;

  const ctx = {
    signal: signal ?? new AbortController().signal,
    requestId: body['id'] as string | number,
    // Tasks outlive the request, so they are stored under the caller's stable
    // principal rather than a per-request identifier that would never be found
    // again by `tasks/get`.
    authInfo: taskDecision.kind === 'create' ? { ...(authInfo ?? {}), sessionId: taskDecision.owner } : authInfo,
    sendNotification: async () => undefined,
    sendRequest: async () => {
      // 2026-07-28 removed the server→client request direction outright. A
      // handler reaching for it is a bug, not a transport limitation.
      throw new McpError(-32603, 'Server-initiated requests were removed in protocol 2026-07-28; use MRTR');
    },
  };

  try {
    const raw = (await handler.handler(dispatchBody as never, ctx as never)) as Record<string, unknown>;

    // The shared stage answers with a 2025-shaped `{ task }` result; project it
    // onto this revision's `resultType: "task"` envelope.
    if (taskDecision.kind === 'create' && raw['task']) {
      const created = await scope.taskStore?.get((raw['task'] as { taskId: string }).taskId, taskDecision.owner);
      if (created) return { kind: 'result', result: decorate(buildCreateTaskResult(created)) };
    }

    return { kind: 'result', result: decorate(raw) };
  } catch (error) {
    if (error instanceof InputRequiredSignal) {
      // The spec restricts interim results to prompts/get, resources/read and
      // tools/call. Anywhere else an `input_required` result would be a protocol
      // violation the client is not expecting, so surface it as a server error
      // instead of emitting a response no conforming client can act on.
      if (!(MRTR_CAPABLE_METHODS as readonly string[]).includes(method)) {
        return {
          kind: 'error',
          status: 200,
          error: {
            code: -32603,
            message: `Internal error: ${method} cannot return an input_required result under protocol 2026-07-28`,
          },
        };
      }
      return { kind: 'result', result: decorate(buildInputRequiredResult(error)) };
    }
    const mapped = toJsonRpcError(error);
    return { kind: 'error', status: mapped.status, error: mapped.error };
  }
}
