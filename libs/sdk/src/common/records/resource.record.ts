import { Type } from '../interfaces';
import { ResourceMetadata } from '../metadata';
import { ResourceEntry } from '../entries';

export enum ResourceKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
}

export type ResourceClassTokenRecord = {
  kind: ResourceKind.CLASS_TOKEN;
  provide: Type<ResourceEntry>;
  metadata: ResourceMetadata
};

export type ResourceFunctionRecord = {
  kind: ResourceKind.FUNCTION;
  provide: (...args: any[]) => any | Promise<any>;
  metadata: ResourceMetadata
};

export type ResourceRecord =
  | ResourceClassTokenRecord
  | ResourceFunctionRecord;


// TODO: support resource templates
// ResourceTemplateKind,
// ResourceTemplateClassToken,
// ResourceTemplateFunction,
// ResourceTemplateRecord,