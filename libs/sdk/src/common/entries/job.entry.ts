import { BaseEntry, EntryOwnerRef } from './base.entry';
import { JobRecord, JobKind } from '../records';
import { JobContext } from '../interfaces';
import { ToolInputType, ToolOutputType } from '../metadata';
import { JobMetadata } from '../metadata/job.metadata';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import type ProviderRegistry from '../../provider/provider.registry';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import type { SafeTransformResult } from './tool.entry';

export abstract class JobEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends BaseEntry<JobRecord, JobContext<InSchema, OutSchema, In, Out>, JobMetadata> {
  owner: EntryOwnerRef;
  name: string;
  fullName: string;

  inputSchema: InSchema;
  outputSchema: OutSchema;

  abstract get providers(): ProviderRegistry;

  isDynamic(): boolean {
    return this.record.kind === JobKind.DYNAMIC;
  }

  isHidden(): boolean {
    return this.metadata.hideFromDiscovery === true;
  }

  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  getLabels(): Record<string, string> {
    return this.metadata.labels ?? {};
  }

  /**
   * Get the job's input schema as JSON Schema.
   */
  getInputJsonSchema(): Record<string, unknown> | null {
    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      try {
        return toJSONSchema(z.object(this.inputSchema)) as Record<string, unknown>;
      } catch {
        return { type: 'object', properties: {} };
      }
    }
    return null;
  }

  /**
   * Get the job's output schema as JSON Schema.
   */
  getOutputJsonSchema(): Record<string, unknown> | null {
    const outSchema = this.outputSchema as unknown;
    if (!outSchema) return null;
    try {
      if (outSchema instanceof z.ZodType) {
        return toJSONSchema(outSchema) as Record<string, unknown>;
      }
      if (outSchema && typeof outSchema === 'object') {
        return toJSONSchema(z.object(outSchema as z.ZodRawShape)) as Record<string, unknown>;
      }
    } catch {
      return { type: 'object', properties: {} };
    }
    return null;
  }

  abstract create(
    input: In,
    extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: any },
  ): JobContext<InSchema, OutSchema, In, Out>;

  abstract parseInput(input: unknown): In;

  abstract parseOutput(raw: Out | Partial<Out>): unknown;

  abstract safeParseOutput(raw: Out | Partial<Out>): SafeTransformResult<unknown>;
}
