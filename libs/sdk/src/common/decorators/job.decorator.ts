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

export { FrontMcpJob, FrontMcpJob as Job, frontMcpJob, frontMcpJob as job };
