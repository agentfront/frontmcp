import { Type } from '@frontmcp/di';
import { PromptMetadata } from '../metadata';
import { PromptEntry } from '../entries';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import type { RemoteTransportOptions, RemoteAuthConfig } from '../metadata';
import type { EsmOptions } from '../metadata';

export enum PromptKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  ESM = 'ESM',
  REMOTE = 'REMOTE',
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

/** Single named prompt loaded from an npm package at runtime */
export type PromptEsmTargetRecord = {
  kind: PromptKind.ESM;
  provide: symbol;
  specifier: ParsedPackageSpecifier;
  /** Which prompt to load from the package */
  targetName: string;
  options?: EsmOptions;
  metadata: PromptMetadata;
};

/** Single named prompt proxied from a remote MCP server */
export type PromptRemoteRecord = {
  kind: PromptKind.REMOTE;
  provide: symbol;
  /** Remote MCP server URL */
  url: string;
  /** Which prompt to proxy */
  targetName: string;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  metadata: PromptMetadata;
};

export type PromptRecord =
  | PromptClassTokenRecord
  | PromptFunctionTokenRecord
  | PromptEsmRecord
  | PromptEsmTargetRecord
  | PromptRemoteRecord;
