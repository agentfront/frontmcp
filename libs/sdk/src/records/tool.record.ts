import {ToolContext, Type} from '../interfaces';
import {ToolMetadata} from '../metadata';


export enum ToolKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
}

export type ToolClassTokenRecord = {
  kind: ToolKind.CLASS_TOKEN;
  provide: Type<ToolContext<any, any>>;
  metadata: ToolMetadata
};

export type ToolFunctionTokenRecord = {
  kind: ToolKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ToolMetadata
};

export type ToolRecord =
  | ToolClassTokenRecord
  | ToolFunctionTokenRecord;
