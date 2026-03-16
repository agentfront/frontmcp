import { Type } from '@frontmcp/di';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { ResourceEntry } from '../entries';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';
import type { RemoteTransportOptions, RemoteAuthConfig } from '../metadata';
import type { EsmOptions } from '../metadata';

// ============================================================================
// Static Resource Records
// ============================================================================

export enum ResourceKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  ESM = 'ESM',
  REMOTE = 'REMOTE',
}

export type ResourceClassTokenRecord = {
  kind: ResourceKind.CLASS_TOKEN;
  provide: Type<ResourceEntry>;
  metadata: ResourceMetadata;
};

// NOTE: `any` is intentional - function providers must be loosely typed
// to support various input/output schema combinations at runtime
export type ResourceFunctionRecord = {
  kind: ResourceKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ResourceMetadata;
};

export type ResourceEsmRecord = {
  kind: ResourceKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: ResourceMetadata;
};

/** Single named resource loaded from an npm package at runtime */
export type ResourceEsmTargetRecord = {
  kind: ResourceKind.ESM;
  provide: symbol;
  specifier: ParsedPackageSpecifier;
  /** Which resource to load from the package */
  targetName: string;
  options?: EsmOptions;
  metadata: ResourceMetadata;
};

/** Single named resource proxied from a remote MCP server */
export type ResourceRemoteRecord = {
  kind: ResourceKind.REMOTE;
  provide: symbol;
  /** Remote MCP server URL */
  url: string;
  /** Which resource to proxy */
  targetName: string;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  metadata: ResourceMetadata;
};

export type ResourceRecord =
  | ResourceClassTokenRecord
  | ResourceFunctionRecord
  | ResourceEsmRecord
  | ResourceEsmTargetRecord
  | ResourceRemoteRecord;

// ============================================================================
// Resource Template Records
// ============================================================================

export enum ResourceTemplateKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
}

export type ResourceTemplateClassTokenRecord = {
  kind: ResourceTemplateKind.CLASS_TOKEN;
  provide: Type<ResourceEntry>;
  metadata: ResourceTemplateMetadata;
};

// NOTE: `any` is intentional - see ResourceFunctionRecord
export type ResourceTemplateFunctionRecord = {
  kind: ResourceTemplateKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ResourceTemplateMetadata;
};

export type ResourceTemplateRecord = ResourceTemplateClassTokenRecord | ResourceTemplateFunctionRecord;

// ============================================================================
// Union type for any resource record (static or template)
// ============================================================================

export type AnyResourceRecord = ResourceRecord | ResourceTemplateRecord;
