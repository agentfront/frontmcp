import { Type } from '@frontmcp/di';
import { WorkflowMetadata } from '../metadata';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import type { RemoteTransportOptions, RemoteAuthConfig } from '../metadata';
import type { EsmOptions } from '../metadata';

export enum WorkflowKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  VALUE = 'VALUE',
  DYNAMIC = 'DYNAMIC',
  ESM = 'ESM',
  REMOTE = 'REMOTE',
}

export type WorkflowClassTokenRecord = {
  kind: WorkflowKind.CLASS_TOKEN;
  provide: Type<any>;
  metadata: WorkflowMetadata;
};

export type WorkflowValueRecord = {
  kind: WorkflowKind.VALUE;
  provide: symbol;
  metadata: WorkflowMetadata;
};

export type WorkflowDynamicRecord = {
  kind: WorkflowKind.DYNAMIC;
  provide: string;
  metadata: WorkflowMetadata;
  registeredBy?: string;
  registeredAt: number;
};

export type WorkflowEsmRecord = {
  kind: WorkflowKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: WorkflowMetadata;
};

/** Single named workflow loaded from an npm package at runtime */
export type WorkflowEsmTargetRecord = {
  kind: WorkflowKind.ESM;
  provide: symbol;
  specifier: ParsedPackageSpecifier;
  /** Which workflow to load from the package */
  targetName: string;
  options?: EsmOptions;
  metadata: WorkflowMetadata;
};

/** Single named workflow proxied from a remote MCP server */
export type WorkflowRemoteRecord = {
  kind: WorkflowKind.REMOTE;
  provide: symbol;
  /** Remote MCP server URL */
  url: string;
  /** Which workflow to proxy */
  targetName: string;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  metadata: WorkflowMetadata;
};

export type WorkflowRecord =
  | WorkflowClassTokenRecord
  | WorkflowValueRecord
  | WorkflowDynamicRecord
  | WorkflowEsmRecord
  | WorkflowEsmTargetRecord
  | WorkflowRemoteRecord;
