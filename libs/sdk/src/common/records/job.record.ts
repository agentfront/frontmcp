import { Type } from '@frontmcp/di';
import { JobContext } from '../interfaces';
import { JobMetadata } from '../metadata';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import type { RemoteTransportOptions, RemoteAuthConfig } from '../metadata';
import type { EsmOptions } from '../metadata';

export enum JobKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  DYNAMIC = 'DYNAMIC',
  ESM = 'ESM',
  REMOTE = 'REMOTE',
}

export type JobClassTokenRecord = {
  kind: JobKind.CLASS_TOKEN;
  provide: Type<JobContext>;
  metadata: JobMetadata;
};

// NOTE: `any` is intentional - function providers must be loosely typed
// to support various input/output schema combinations at runtime
export type JobFunctionTokenRecord = {
  kind: JobKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: JobMetadata;
};

export type JobDynamicRecord = {
  kind: JobKind.DYNAMIC;
  provide: string; // Job ID used as token
  metadata: JobMetadata;
  script: string;
  registeredBy?: string;
  registeredAt: number;
};

export type JobEsmRecord = {
  kind: JobKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: JobMetadata;
};

/** Single named job loaded from an npm package at runtime */
export type JobEsmTargetRecord = {
  kind: JobKind.ESM;
  provide: symbol;
  specifier: ParsedPackageSpecifier;
  /** Which job to load from the package */
  targetName: string;
  options?: EsmOptions;
  metadata: JobMetadata;
};

/** Single named job proxied from a remote MCP server */
export type JobRemoteRecord = {
  kind: JobKind.REMOTE;
  provide: symbol;
  /** Remote MCP server URL */
  url: string;
  /** Which job to proxy */
  targetName: string;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  metadata: JobMetadata;
};

export type JobRecord =
  | JobClassTokenRecord
  | JobFunctionTokenRecord
  | JobDynamicRecord
  | JobEsmRecord
  | JobEsmTargetRecord
  | JobRemoteRecord;
