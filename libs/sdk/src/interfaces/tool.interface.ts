import { FuncType, Token, ToolMetadata, Type } from '@frontmcp/sdk';


export type ToolType<T = any> =
  | Type<T>
  | FuncType<T>


export abstract class ToolInterface<In, Out> {
  abstract execute(input: In, context: ToolContext<In, Out>): Promise<Out>;
}

export interface ToolContext<In, Out> {
  readonly toolId: string;
  readonly toolName: string;
  readonly metadata: ToolMetadata;


  get<T>(token: Token<T>): T;

  tryGet<T>(token: Token<T>): T | undefined;

  get inputHistory(): In[];

  get outputHistory(): Out[];

  set input(value: In);

  get input(): In;

  set output(value: Out);

  get output(): Out | undefined;

  respond(value: Out): never;

  fail(reason: string, error: any): never;
}

