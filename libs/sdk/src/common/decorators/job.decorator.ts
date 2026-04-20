import 'reflect-metadata';

import type z from '@frontmcp/lazy-zod';

import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { type JobContext } from '../interfaces';
import { type EsmOptions, type RemoteOptions, type ToolInputType, type ToolOutputType } from '../metadata';
import { frontMcpJobMetadataSchema, type JobMetadata } from '../metadata/job.metadata';
// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Job.esm() and Job.remote()
// ═══════════════════════════════════════════════════════════════════

import { JobKind, type JobEsmTargetRecord, type JobRemoteRecord } from '../records/job.record';
import { extendedJobMetadata, FrontMcpJobTokens } from '../tokens';
import { validateRemoteUrl } from '../utils/validate-remote-url';
import { type ToolInputOf, type ToolOutputOf } from './tool.decorator';

/**
 * Decorator that marks a class as a Job and provides metadata.
 */
function _FrontMcpJob(providedMetadata: JobMetadata): ClassDecorator {
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

Object.assign(_FrontMcpJob, {
  esm: jobEsm,
  remote: jobRemote,
});

// ============================================================================
// Type Checking Helpers
// ============================================================================

// ---------- zod helpers ----------
type __Shape = z.ZodRawShape;

// --- output schema constraint types ---
type __PrimitiveOutputType =
  | 'string'
  | 'number'
  | 'date'
  | 'boolean'
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodBigInt
  | z.ZodDate;
type __MediaOutputType = 'image' | 'audio' | 'resource' | 'resource_link';
type __StructuredOutputType =
  | z.ZodRawShape
  | z.ZodObject<any>
  | z.ZodArray<z.ZodType>
  | z.ZodUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>
  | z.ZodDiscriminatedUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>;
type __JobSingleOutputType = __PrimitiveOutputType | __MediaOutputType | __StructuredOutputType;
type __OutputSchema = __JobSingleOutputType | __JobSingleOutputType[];

// ---------- ctor & reflection ----------
type __Ctor = (new (...a: any[]) => any) | (abstract new (...a: any[]) => any);
type __A<C extends __Ctor> = C extends new (...a: infer A) => any
  ? A
  : C extends abstract new (...a: infer A) => any
    ? A
    : never;
type __R<C extends __Ctor> = C extends new (...a: any[]) => infer R
  ? R
  : C extends abstract new (...a: any[]) => infer R
    ? R
    : never;
// Tuple-based parameter inference. See tool.decorator.ts for full rationale.
type __ExecParams<C extends __Ctor> = __R<C> extends { execute: (...args: infer P) => unknown } ? P : never;
// True only when the parameter tuple is exactly `[]` (zero-arg execute).
type __HasNoParam<C extends __Ctor> = [__ExecParams<C>] extends [readonly []] ? true : false;
type __Param<C extends __Ctor> = __ExecParams<C> extends readonly [infer P, ...unknown[]] ? P : never;
type __Return<C extends __Ctor> = __R<C> extends { execute: (...a: any) => infer R } ? R : never;
type __Unwrap<T> = T extends Promise<infer U> ? U : T;
type __IsAny<T> = 0 extends 1 & T ? true : false;

// ---------- friendly branded errors ----------

// Must extend JobContext
type __MustExtendCtx<C extends __Ctor> =
  __R<C> extends JobContext ? unknown : { 'Job class error': 'Class must extend JobContext' };

// execute param must exactly match In (and not be any).
type __MustParam<C extends __Ctor, In> =
  __IsAny<In> extends true
    ? unknown
    : __IsAny<__Param<C>> extends true
      ? { 'execute() parameter error': "Parameter type must not be 'any'."; expected_input_type: In }
      : // Truly no parameter (execute()) — allow only when In accepts an empty object.
        //    Uses __HasNoParam (tuple-shape check) so `execute(input: never)` is NOT
        //    confused with `execute()`.
        __HasNoParam<C> extends true
        ? In extends Record<string, never>
          ? unknown
          : {
              'execute() parameter error': 'execute() requires a parameter matching the input schema.';
              expected_input_type: In;
            }
        : __Param<C> extends In
          ? In extends __Param<C>
            ? unknown
            : {
                'execute() parameter error': 'Parameter type is too wide. It must exactly match the input schema.';
                expected_input_type: In;
                actual_parameter_type: __Param<C>;
              }
          : {
              'execute() parameter error': 'Parameter type does not match the input schema.';
              expected_input_type: In;
              actual_parameter_type: __Param<C>;
            };

// execute return must be Out or Promise<Out> (and not be any)
type __MustReturn<C extends __Ctor, Out> =
  __IsAny<Out> extends true
    ? unknown
    : __IsAny<__Unwrap<__Return<C>>> extends true
      ? { 'execute() return type error': "Return type must not be 'any'."; expected_output_type: Out }
      : __Unwrap<__Return<C>> extends Out
        ? unknown
        : {
            'execute() return type error': "The method's return type is not assignable to the expected output schema type.";
            expected_output_type: Out;
            'actual_return_type (unwrapped)': __Unwrap<__Return<C>>;
          };

// Rewrapped constructor with updated JobContext generic params
// `any` in schema positions is intentional: JobContext's InSchema/OutSchema generics
// require ZodRawShape/ToolOutputType constraints that `unknown` cannot satisfy.
type __Rewrap<C extends __Ctor, In, Out> = C extends abstract new (...a: __A<C>) => __R<C>
  ? C & (abstract new (...a: __A<C>) => JobContext<any, any, In, Out> & __R<C>)
  : C extends new (...a: __A<C>) => __R<C>
    ? C & (new (...a: __A<C>) => JobContext<any, any, In, Out> & __R<C>)
    : never;

// ---------- typed decorator ----------
interface JobDecorator {
  // 1) Overload: outputSchema PROVIDED → strict return typing
  <I extends __Shape, O extends __OutputSchema>(
    opts: JobMetadata<I, O> & { outputSchema: O },
  ): <C extends __Ctor>(
    cls: C &
      __MustExtendCtx<C> &
      __MustParam<C, ToolInputOf<{ inputSchema: I }>> &
      __MustReturn<C, ToolOutputOf<{ outputSchema: O }>>,
  ) => __Rewrap<C, ToolInputOf<{ inputSchema: I }>, ToolOutputOf<{ outputSchema: O }>>;

  esm: typeof jobEsm;
  remote: typeof jobRemote;
}

const FrontMcpJob = _FrontMcpJob as unknown as JobDecorator;
const Job = _FrontMcpJob as unknown as JobDecorator;

export { FrontMcpJob, Job, frontMcpJob, frontMcpJob as job };
