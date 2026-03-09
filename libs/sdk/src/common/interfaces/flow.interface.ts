import { Token, Type } from '@frontmcp/di';
import { FlowMetadata, FlowName } from '../metadata';
import { z } from 'zod';
import { HookEntry, ScopeEntry } from '../entries';
import { FlowState, FlowStateOf } from './internal/flow.utils';
import { FrontMcpLogger } from './logger.interface';
import type { FrontMcpContext } from '../../context/frontmcp-context';
import { FrontMcpContextStorage } from '../../context/frontmcp-context-storage';

export type FlowInputOf<N extends FlowName> = z.infer<ExtendFlows[N]['input']>;
export type FlowOutputOf<N extends FlowName> = z.infer<ExtendFlows[N]['output']>;
export type FlowPlanOf<N extends FlowName> = ExtendFlows[N]['plan'];
export type FlowCtxOf<N extends FlowName> = ExtendFlows[N]['ctx'];
export type FlowStagesOf<N extends FlowName> = ExtendFlows[N]['stage'];
export type FlowExecuteStagesOf<N extends FlowName> = ExtendFlows[N]['executeStage'];

export type FlowControlType = 'respond' | 'fail' | 'abort' | 'next' | 'handled';

export class FlowControl extends Error {
  constructor(
    public readonly type: FlowControlType,
    public readonly output: any,
  ) {
    super();
  }

  static respond<T>(output: T): never {
    throw new FlowControl('respond', output);
  }

  static next(): never {
    throw new FlowControl('next', null);
  }

  static handled(): never {
    throw new FlowControl('handled', null);
  }

  static fail(error: Error): never {
    throw new FlowControl('fail', { error: error.message });
  }

  static abort(reason: string): never {
    throw new FlowControl('abort', reason);
  }
}

// 1) The actual abstract class (value)
export abstract class FlowBase<N extends FlowName = FlowName> {
  protected input: FlowInputOf<N>;
  state: FlowStateOf<N> = FlowState.create({});
  scopeLogger: FrontMcpLogger;

  constructor(
    protected readonly metadata: FlowMetadata<N>,
    readonly rawInput: Partial<FlowInputOf<N>> | any,
    protected readonly scope: ScopeEntry,
    protected readonly appendContextHooks: (hooks: HookEntry[]) => void,
    protected readonly deps: ReadonlyMap<Token, unknown> = new Map(),
  ) {
    this.input = (metadata.inputSchema as any)?.parse?.(rawInput);
    this.scopeLogger = scope.logger;
  }

  get<T>(token: Token<T>): T {
    if (this.deps.has(token)) return this.deps.get(token) as T;
    return this.scope.providers.get(token);
  }

  respond(output: FlowOutputOf<N>) {
    throw FlowControl.respond((this.metadata.outputSchema as z.ZodObject<any>).parse(output));
  }

  fail(error: Error) {
    throw FlowControl.fail(error);
  }

  protected abort(message: string) {
    throw FlowControl.abort(message);
  }

  protected next() {
    throw FlowControl.next();
  }

  protected handled() {
    throw FlowControl.handled();
  }

  /**
   * Get the current FrontMcpContext from AsyncLocalStorage.
   * Available in all stages after context initialization.
   *
   * @throws Error if not in a context scope
   */
  protected get context(): FrontMcpContext {
    const storage = this.scope.providers.get(FrontMcpContextStorage);
    return storage.getStoreOrThrow();
  }

  /**
   * Safely try to get FrontMcpContext (returns undefined if not available).
   * Use this when context might not be available (e.g., non-HTTP flows).
   */
  protected tryGetContext(): FrontMcpContext | undefined {
    try {
      const storage = this.scope.providers.get(FrontMcpContextStorage);
      return storage.getStore();
    } catch {
      return undefined;
    }
  }
}

export type FlowType<Provide = FlowBase<any>> = Type<Provide>;
