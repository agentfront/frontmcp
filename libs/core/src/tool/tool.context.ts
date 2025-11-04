import {
  ControlAbort,
  ControlRespond,
  ControlRetryAfter,
} from '../types/invoke.type';
import { ProviderViews } from '../provider/provider.types';
import { TOOL_REGISTRY } from './tool.tokens';
import { ToolRegistryContract } from './tool.types';
import { ToolMetadata, ProviderScope, Token } from '@frontmcp/sdk';

declare global {
  export interface ContextUser {
    // can be extended by plugins to include more user info
    id: string | number;
  }
}

export interface ToolInvokeContextOptions<InputSchema = any> {
  toolId: string;
  toolName: string;
  toolMetadata: ToolMetadata;
  sessionId: string;
  requestId: string | number;
  input: InputSchema;
  user: ContextUser;
  providers: ProviderViews;
}

export class ToolInvokeContext<
  InputSchema = any,
  OutputSchema = any
> {
  // identity
  readonly toolId: string;
  readonly toolName: string;
  readonly sessionId: string;
  readonly requestId: string | number;
  readonly metadata: ToolMetadata;


  // DI (request-local map that we “wire” globals + session into)
  // provider views (resolution order: request -> session -> global)
  #providers: ProviderViews;

  /** Add/override a provider instance at a given scope (defaults to 'request'). */
  bindProvider<T>(
    token: Token<T>,
    instance: T,
    scope: ProviderScope = ProviderScope.REQUEST,
  ) {
    if (scope === 'global')
      throw new Error('Global providers are immutable at invoke-time');
    const map =
      scope === 'session' ? this.#providers.session : this.#providers.request;
    map.set(token, instance);
  }

  /** Bulk bind (ergonomic for plugins) */
  bindProviders(
    bindings: Array<[Token, unknown]>,
    scope: ProviderScope = ProviderScope.REQUEST,
  ) {
    for (const [t, v] of bindings) this.bindProvider(t, v, scope);
  }

  get<T>(token: Token<T>): T {
    const { request, session, global } = this.#providers;
    if (request.has(token)) return request.get(token) as T;
    if (session.has(token)) return session.get(token) as T;
    if (global.has(token)) return global.get(token) as T;
    throw new Error(`Provider not found for token: ${String(token)}`);
  }

  tryGet<T>(token: Token<T>): T | undefined {
    try {
      return this.get<T>(token);
    } catch {
      return undefined;
    }
  }

  get toolRegistry(): ToolRegistryContract {
    return this.get(TOOL_REGISTRY);
  }

  // histories
  readonly #inputHistory: InputSchema[] = [];
  get inputHistory(): InputSchema[] {
    return [...this.#inputHistory];
  }

  readonly #outputHistory: OutputSchema[] = [];
  get outputHistory(): OutputSchema[] {
    return [...this.#outputHistory];
  }

  // payloads
  #input: InputSchema;
  #output: OutputSchema | undefined;

  set input(value: InputSchema) {
    this.#input = value;
    this.#inputHistory.push(value);
  }

  get input(): InputSchema {
    return this.#input;
  }

  set output(value: OutputSchema) {
    this.#output = value;
    this.#outputHistory.push(value);
  }

  get output(): OutputSchema | undefined {
    return this.#output;
  }

  // user/tenant/etc
  readonly user: ContextUser;

  // scratchpad + error
  data: Map<string, unknown>;
  error?: Error | unknown;

  // timing
  startedAt: number = Date.now();
  finishedAt?: number;

  constructor(options: ToolInvokeContextOptions) {
    this.toolId = options.toolId;
    this.toolName = options.toolName;
    this.metadata = options.toolMetadata;
    this.sessionId = options.sessionId;
    this.requestId = options.requestId;
    this.#input = options.input as any;
    this.#providers = options.providers;
    this.data = new Map();
    this.user = options.user;
  }

  // TODO:
  //  - add support to return types of results (text, image, audio, resource, resource_link
  //  - insure that `Structured Content` added to output along with the stringify output (https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content)
  // control helpers (throw control exceptions)
  respond(value: OutputSchema): never {
    this.output = value;
    throw new ControlRespond(value);
  }

  // TODO:
  //  - error handling must return a valid output error schema (https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling)
  abort(reason: string, code?: string, httpStatus?: number): never {
    throw new ControlAbort(reason, code, httpStatus);
  }

  retryAfter(ms: number, reason?: string): never {
    throw new ControlRetryAfter(ms, reason);
  }
}
