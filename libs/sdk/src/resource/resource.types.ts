// file: libs/sdk/src/resource/resource.types.ts

import { EntryLineage, Token, Type, FuncType, ResourceTemplateMetadata } from '../common';
import { ResourceInstance } from './resource.instance';
import ResourceRegistry from './resource.registry';
import { ResourceEntry } from '../common/entries';
import type { NameCase } from '../utils/naming.utils';

// Re-export NameCase as ResourceNameCase for backwards compatibility
export type ResourceNameCase = NameCase;

// ============================================================================
// Resource Template Record Types (extending resource.record.ts)
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

export type ResourceTemplateFunctionRecord = {
  kind: ResourceTemplateKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ResourceTemplateMetadata;
};

export type ResourceTemplateRecord = ResourceTemplateClassTokenRecord | ResourceTemplateFunctionRecord;

// ============================================================================
// Resource Template Type (interface equivalent)
// ============================================================================

export interface ResourceTemplateInterface<In = any, Out = any> {
  execute(uri: string, params: Record<string, string>, context: any): Promise<Out>;
}

export type ResourceTemplateType<In = any, Out = any> =
  | Type<ResourceTemplateInterface<In, Out>>
  | FuncType<ResourceTemplateInterface<In, Out>>;

// ============================================================================
// Indexed Resource (for registry internal use)
// ============================================================================

/** Internal augmented row: instance + provenance + token */
export type IndexedResource = {
  token: Token;
  instance: ResourceInstance;
  /** base resource name from metadata (unmodified) */
  baseName: string;
  /** URI for static resources */
  uri?: string;
  /** URI template for template resources */
  uriTemplate?: string;
  /** Whether this is a template resource */
  isTemplate: boolean;
  /** lineage & qualified info */
  lineage: EntryLineage;
  ownerKey: string; // "app:Portal/plugin:Okta"
  qualifiedName: string; // "app:Portal/plugin:Okta:resourceName"
  qualifiedId: string; // "app:Portal/plugin:Okta:tokenName(<token>)"
  /** which registry constructed the instance (the "owner" registry) */
  source: ResourceRegistry;
};

// ============================================================================
// Export Name Options
// ============================================================================

export type ResourceExportOptions = {
  case?: ResourceNameCase; // default 'snake'
  maxLen?: number; // default 64
  prefixChildrenOnConflict?: boolean; // default true
  prefixSource?: 'provider' | 'owner'; // default 'provider'
};

export const DEFAULT_RESOURCE_EXPORT_OPTS: Required<ResourceExportOptions> = {
  case: 'snake',
  maxLen: 64,
  prefixChildrenOnConflict: true,
  prefixSource: 'provider',
};
