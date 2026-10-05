import { type Type } from '@frontmcp/di';

import { type ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import { type PromptEntry } from '../entries';
import {
  type EsmOptions,
  type PromptMetadata,
  type RemoteAuthConfig,
  type RemoteOptions,
  type RemoteTransportOptions,
} from '../metadata';

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
  options?: EsmOptions<PromptMetadata>;
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
  options?: RemoteOptions<PromptMetadata>;
  metadata: PromptMetadata;
};

/** A record whose prompts are loaded from a package or a remote server when its registry starts. */
export type PromptExternalRecord = PromptEsmRecord | PromptEsmTargetRecord | PromptRemoteRecord;

export type PromptRecord =
  | PromptClassTokenRecord
  | PromptFunctionTokenRecord
  | PromptEsmRecord
  | PromptEsmTargetRecord
  | PromptRemoteRecord;
