import { ResourceMetadata } from '../metadata';
import { FuncType, Token, Type } from './base.interface';


export interface ResourceInterface<In = any, Out = any> {
  execute(input: In, context: ResourceContext<In, Out>): Promise<Out>;
}

export type ResourceType<In = any, Out = any> =
  | Type<ResourceInterface<In, Out>>
  | FuncType<ResourceInterface<In, Out>>


export interface ResourceContext<In, Out> {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly metadata: ResourceMetadata;


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