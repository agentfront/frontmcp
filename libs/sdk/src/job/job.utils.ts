import { Token, Type, depsOfClass, depsOfFunc, isClass, getMetadata } from '@frontmcp/di';
import { InvalidEntityError } from '../errors';
import { JobMetadata, frontMcpJobMetadataSchema } from '../common/metadata/job.metadata';
import { FrontMcpJobTokens, extendedJobMetadata } from '../common/tokens/job.tokens';
import { JobRecord, JobKind } from '../common/records/job.record';
import { JobContext, JobType } from '../common/interfaces/job.interface';

export function collectJobMetadata(cls: JobType): JobMetadata {
  const extended = getMetadata(extendedJobMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as JobMetadata;
  return Object.entries(FrontMcpJobTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, {
        [key]: value,
      });
    } else {
      return metadata;
    }
  }, seed);
}

export function normalizeJob(item: any): JobRecord {
  // Function-style job
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpJobTokens.type] === 'function-job' &&
    item[FrontMcpJobTokens.metadata]
  ) {
    return {
      kind: JobKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpJobTokens.metadata] as JobMetadata,
    };
  }

  // Class-style job
  if (isClass(item)) {
    const metadata = collectJobMetadata(item);
    return { kind: JobKind.CLASS_TOKEN, provide: item as Type<JobContext>, metadata };
  }

  const name = (item as any)?.name ?? String(item);
  throw new InvalidEntityError('job', name, 'a class or a job object');
}

/**
 * For graph/cycle detection. Returns dependency tokens.
 */
export function jobDiscoveryDeps(rec: JobRecord): Token[] {
  switch (rec.kind) {
    case JobKind.FUNCTION:
      return depsOfFunc(rec.provide, 'discovery');
    case JobKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
    case JobKind.DYNAMIC:
      return []; // Dynamic jobs have no compile-time deps
  }
}
