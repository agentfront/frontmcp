import { Type } from '../interfaces';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { ResourceEntry } from '../entries';

// ============================================================================
// Static Resource Records
// ============================================================================

export enum ResourceKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
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

export type ResourceRecord = ResourceClassTokenRecord | ResourceFunctionRecord;

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
