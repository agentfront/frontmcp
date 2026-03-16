import 'reflect-metadata';
import { extendedJobMetadata, FrontMcpJobTokens } from '../tokens';
import { JobMetadata, frontMcpJobMetadataSchema } from '../metadata/job.metadata';
import { ToolInputType, ToolOutputType } from '../metadata';
import { JobContext } from '../interfaces';
import { ToolInputOf, ToolOutputOf } from './tool.decorator';

/**
 * Decorator that marks a class as a Job and provides metadata.
 */
function FrontMcpJob(providedMetadata: JobMetadata): ClassDecorator {
  return (target: any) => {
    const metadata = frontMcpJobMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpJobTokens.type, true, target);
    const extended = {};
    for (const property in metadata) {
      if (FrontMcpJobTokens[property]) {
        Reflect.defineMetadata(FrontMcpJobTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedJobMetadata, extended, target);
  };
}

export type FrontMcpJobExecuteHandler<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> = (input: In, ctx: JobContext<InSchema, OutSchema>) => Out | Promise<Out>;

/**
 * Function builder for creating jobs without classes.
 */
function frontMcpJob<
  T extends JobMetadata,
  InSchema extends ToolInputType = T['inputSchema'],
  OutSchema extends ToolOutputType = NonNullable<T['outputSchema']>,
>(
  providedMetadata: T,
): (handler: FrontMcpJobExecuteHandler<InSchema, OutSchema>) => () => FrontMcpJobExecuteHandler<InSchema, OutSchema> {
  return (execute) => {
    const metadata = frontMcpJobMetadataSchema.parse(providedMetadata);
    const jobFunction = function () {
      return execute;
    };
    Object.assign(jobFunction, {
      [FrontMcpJobTokens.type]: 'function-job',
      [FrontMcpJobTokens.metadata]: metadata,
    });
    return jobFunction;
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Job.esm() and Job.remote()
// ═══════════════════════════════════════════════════════════════════

import type { EsmOptions, RemoteOptions } from '../metadata';
import { JobKind } from '../records/job.record';
import type { JobEsmTargetRecord, JobRemoteRecord } from '../records/job.record';
import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { validateRemoteUrl } from '../utils/validate-remote-url';

function jobEsm(specifier: string, targetName: string, options?: EsmOptions<JobMetadata>): JobEsmTargetRecord {
  const parsed = parsePackageSpecifier(specifier);
  return {
    kind: JobKind.ESM,
    provide: Symbol(`esm-job:${parsed.fullName}:${targetName}`),
    specifier: parsed,
    targetName,
    options,
    metadata: {
      name: targetName,
      description: `Job "${targetName}" from ${parsed.fullName}`,
      inputSchema: {},
      outputSchema: {},
      ...options?.metadata,
    },
  };
}

function jobRemote(url: string, targetName: string, options?: RemoteOptions<JobMetadata>): JobRemoteRecord {
  validateRemoteUrl(url);
  return {
    kind: JobKind.REMOTE,
    provide: Symbol(`remote-job:${url}:${targetName}`),
    url,
    targetName,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    metadata: {
      name: targetName,
      description: `Remote job "${targetName}" from ${url}`,
      inputSchema: {},
      outputSchema: {},
      ...options?.metadata,
    },
  };
}

Object.assign(FrontMcpJob, {
  esm: jobEsm,
  remote: jobRemote,
});

type JobDecorator = {
  (metadata: JobMetadata): ClassDecorator;
  esm: typeof jobEsm;
  remote: typeof jobRemote;
};

const Job = FrontMcpJob as unknown as JobDecorator;

export { FrontMcpJob, Job, frontMcpJob, frontMcpJob as job };
