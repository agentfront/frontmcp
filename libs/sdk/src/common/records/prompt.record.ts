import { Type } from '../interfaces';
import { PromptMetadata } from '../metadata';
import { PromptEntry } from '../entries';

export enum PromptKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
}

export type PromptClassTokenRecord = {
  kind: PromptKind.CLASS_TOKEN;
  provide: Type<PromptEntry>;
  metadata: PromptMetadata
};

export type PromptFunctionTokenRecord = {
  kind: PromptKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: PromptMetadata
};

export type PromptRecord =
  | PromptClassTokenRecord
  | PromptFunctionTokenRecord;
