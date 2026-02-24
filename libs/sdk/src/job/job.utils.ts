import { Token, Type, depsOfClass, depsOfFunc, isClass, getMetadata } from '@frontmcp/di';
import { InvalidEntityError } from '../errors';
import { JobMetadata } from '../common/metadata/job.metadata';
import { FrontMcpJobTokens, extendedJobMetadata } from '../common/tokens/job.tokens';
import { JobRecord, JobKind, JobFunctionTokenRecord } from '../common/records/job.record';
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

export function normalizeJob(item: unknown): JobRecord {
  // Function-style job
  const fn = item as Record<string | symbol, unknown>;
  if (
    item &&
    typeof item === 'function' &&
    fn[FrontMcpJobTokens.type] === 'function-job' &&
    fn[FrontMcpJobTokens.metadata]
  ) {
    return {
      kind: JobKind.FUNCTION,
      provide: (item as () => JobFunctionTokenRecord['provide'])(),
      metadata: fn[FrontMcpJobTokens.metadata] as JobMetadata,
    };
  }

  // Class-style job
  if (isClass(item)) {
    const metadata = collectJobMetadata(item);
    return { kind: JobKind.CLASS_TOKEN, provide: item as Type<JobContext>, metadata };
  }

  const name =
    (item != null && typeof item === 'object' && 'name' in item ? (item as { name: string }).name : undefined) ??
    String(item);
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
