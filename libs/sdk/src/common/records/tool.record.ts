import { Type } from '@frontmcp/di';
import { ToolContext } from '../interfaces';
import { ToolMetadata } from '../metadata';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';

export enum ToolKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  ESM = 'ESM',
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

export type ToolEsmRecord = {
  kind: ToolKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: ToolMetadata;
};

export type ToolRecord = ToolClassTokenRecord | ToolFunctionTokenRecord | ToolEsmRecord;
