import { Type } from '@frontmcp/di';
import { PromptMetadata } from '../metadata';
import { PromptEntry } from '../entries';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';

export enum PromptKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  ESM = 'ESM',
}

export type PromptClassTokenRecord = {
  kind: PromptKind.CLASS_TOKEN;
  provide: Type<PromptEntry>;
  metadata: PromptMetadata;
};

// NOTE: `any` is intentional - function providers must be loosely typed
// to support various input/output schema combinations at runtime
export type PromptFunctionTokenRecord = {
  kind: PromptKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: PromptMetadata;
};

export type PromptEsmRecord = {
  kind: PromptKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: PromptMetadata;
};

export type PromptRecord = PromptClassTokenRecord | PromptFunctionTokenRecord | PromptEsmRecord;
