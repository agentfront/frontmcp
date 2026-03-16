import { Type } from '@frontmcp/di';
import { ToolContext } from '../interfaces';
import { ToolMetadata } from '../metadata';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import type { RemoteTransportOptions, RemoteAuthConfig } from '../metadata';
import type { EsmOptions } from '../metadata';

export enum ToolKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  ESM = 'ESM',
  REMOTE = 'REMOTE',
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

/** Single named tool loaded from an npm package at runtime */
export type ToolEsmTargetRecord = {
  kind: ToolKind.ESM;
  provide: symbol;
  specifier: ParsedPackageSpecifier;
  /** Which tool to load from the package */
  targetName: string;
  options?: EsmOptions;
  metadata: ToolMetadata;
};

/** Single named tool proxied from a remote MCP server */
export type ToolRemoteRecord = {
  kind: ToolKind.REMOTE;
  provide: symbol;
  /** Remote MCP server URL */
  url: string;
  /** Which tool to proxy */
  targetName: string;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  metadata: ToolMetadata;
};

export type ToolRecord =
  | ToolClassTokenRecord
  | ToolFunctionTokenRecord
  | ToolEsmRecord
  | ToolEsmTargetRecord
  | ToolRemoteRecord;
