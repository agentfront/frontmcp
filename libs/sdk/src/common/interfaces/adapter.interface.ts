import { ClassType, FactoryType, Token, Type, ValueType } from './base.interface';
import { ToolType } from './tool.interface';
import { ResourceType } from './resource.interface';
import { PromptType } from './prompt.interface';
import { AdapterMetadata } from '../metadata';
import { FrontMcpLogger } from './logger.interface';

export interface AdapterInterface {
  options: { name: string } & Record<string, unknown>;
  /**
   * Optional method to receive the SDK logger.
   * Called by the SDK before fetch() if implemented.
   */
  setLogger?: (logger: FrontMcpLogger) => void;
  fetch: () => Promise<FrontMcpAdapterResponse> | FrontMcpAdapterResponse;
}

export interface FrontMcpAdapterResponse {
  tools?: ToolType[];
  resources?: ResourceType[];
  prompts?: PromptType[];
}

export type AdapterClassType<Provide> = ClassType<Provide> & AdapterMetadata;
export type AdapterValueType<Provide> = ValueType<Provide> & AdapterMetadata;
export type AdapterFactoryType<Provide, Tokens extends readonly Token[]> = FactoryType<Provide, Tokens> &
  AdapterMetadata;

export type AdapterType<Provide extends AdapterInterface = any> =
  | Type<Provide>
  | AdapterClassType<Provide>
  | AdapterValueType<Provide>
  | AdapterFactoryType<Provide, any[]>;
