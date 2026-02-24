import { Type } from '@frontmcp/di';
import { WorkflowMetadata } from '../metadata';

export enum WorkflowKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  VALUE = 'VALUE',
  DYNAMIC = 'DYNAMIC',
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

export type WorkflowRecord = WorkflowClassTokenRecord | WorkflowValueRecord | WorkflowDynamicRecord;
