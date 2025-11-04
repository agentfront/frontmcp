import { Token, Type } from './base.interface';
import { FlowMetadata, FlowName } from '../metadata';
import { z } from 'zod';
import { ScopeEntry } from '../entries';
import { FlowState, FlowStateOf } from './internal/flow.utils';

export type FlowInputOf<N extends FlowName> = z.infer<ExtendFlows[N]['input']>;
export type FlowOutputOf<N extends FlowName> = z.infer<ExtendFlows[N]['output']>;
export type FlowPlanOf<N extends FlowName> = ExtendFlows[N]['plan'];
export type FlowCtxOf<N extends FlowName> = ExtendFlows[N]['ctx'];


export type FlowControlType = 'respond' | 'fail' | 'abort' | 'next' | 'handled';

export class FlowControl extends Error {
  constructor(public readonly type: FlowControlType, public readonly output: any) {
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
    throw new FlowControl('fail', error);
  }

  static abort(reason: string): never {
    throw new FlowControl('abort', reason);
  }

}


// 1) The actual abstract class (value)
export abstract class FlowBase<N extends FlowName = FlowName> {
  protected input: FlowInputOf<N>;
  state: FlowStateOf<N> = FlowState.create({});

  constructor(
    protected readonly metadata: FlowMetadata<N>,
    protected readonly rawInput: Partial<FlowInputOf<N>> | any,
    protected readonly scope: ScopeEntry,
    protected readonly deps: ReadonlyMap<Token, unknown> = new Map(),
  ) {
    this.input = (metadata.inputSchema as any)?.parse?.(rawInput);
  }

  get<T>(token: Token<T>): T {
    if (this.deps.has(token)) return this.deps.get(token) as T;
    return this.scope.providers.get(token);
  }

  protected respond(output: FlowOutputOf<N>) {
    throw FlowControl.respond((this.metadata.outputSchema as z.ZodObject<any>).parse(output));
  }

  protected fail(error: Error) {
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
}

// 2) The public-facing type = class instance & the dynamic stage methods
// export type BaseFlow<N extends FlowName = FlowName> = BaseFlowCore<N> & StageFns<N>;

// 3) Re-export the class under the convenient name so you can `new BaseFlow(...)`
// export const BaseFlow = BaseFlowCore;

export type FlowType<Provide = FlowBase<FlowName>> =
  | Type<Provide>


// const inputSchema = z.object({
//   id: z.string().min(1),
//   id22: z.string().optional(),
// });
//
// const outputSchema = z.object({
//   testing: z.number(),
// });
//
//
// type Stages = 'parse' | 'test' | 'query'
//
// declare global {
//   interface ExtendFlows {
//     'myFlow': FlowExecute<typeof inputSchema, typeof outputSchema, Stages>;
//   }
// }
//
// @Flow({
//   name: 'myFlow',
//   access: 'public',
//   inputSchema,
//   outputSchema,
//   middleware:{
//     path:'/asdsd'
//   },
//   plan: {
//     pre: ['test'],
//     post: ['query'],
//   },
// })
// class MyFlow {
//
// }
//
// function runFlow<T extends FlowName>(name: T) {
//   return (input: z.infer<ExtendFlows[T]['input']>): z.infer<ExtendFlows[T]['result']> => {
//     return { testing: 11 };
//   };
// }
//
// runFlow('myFlow')({ id: 'asd', id22: 'asd' }).testing;

