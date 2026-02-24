import { Type } from '@frontmcp/di';
import { JobContext } from '../interfaces';
import { JobMetadata } from '../metadata';

export enum JobKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
  FUNCTION = 'FUNCTION',
  DYNAMIC = 'DYNAMIC',
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

export type JobRecord = JobClassTokenRecord | JobFunctionTokenRecord | JobDynamicRecord;
