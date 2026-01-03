import { Type } from '@frontmcp/di';
import { ToolContext } from '../interfaces';
import { ToolMetadata } from '../metadata';

export enum ToolKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
}

export type ToolClassTokenRecord = {
  kind: ToolKind.CLASS_TOKEN;
  provide: Type<ToolContext>;
  metadata: ToolMetadata;
};

// NOTE: `any` is intentional - function providers must be loosely typed
// to support various input/output schema combinations at runtime
export type ToolFunctionTokenRecord = {
  kind: ToolKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ToolMetadata;
};

export type ToolRecord = ToolClassTokenRecord | ToolFunctionTokenRecord;
