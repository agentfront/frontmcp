import { internalZ as z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import type { ToolInputType, ToolOutputType } from '../../common/metadata/tool.metadata';
import { type JobDynamicRecord } from '../../common/records/job.record';
import { DynamicJobRegistrationDisabledError, InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { JobPermissionGuard } from '../job-permission.guard';

@Tool({
  name: 'update_job',
  description:
    'Update a job registered at runtime: its script, schemas, description or tags. The fields given replace its own.',
  inputSchema: {
    name: z.string().describe('Job name to update'),
    description: z.string().optional().describe('New description'),
    script: z.string().optional().describe('New JavaScript source code for the job'),
    inputSchema: z.record(z.string(), z.unknown()).optional().describe('New JSON Schema for input'),
    outputSchema: z.record(z.string(), z.unknown()).optional().describe('New JSON Schema for output'),
    tags: z.array(z.string()).optional().describe('New tags'),
  },
  outputSchema: {
    success: z.boolean(),
    jobId: z.string(),
  },
  hideFromDiscovery: true,
})
export default class UpdateJobTool extends ToolContext {
  async execute(input: {
    name: string;
    description?: string;
    script?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    tags?: string[];
  }) {
    const jobRegistry = this.scope.jobs;
    if (!jobRegistry) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    // Defense in depth, as register_job: the tool is registered only with `jobs.allowDynamicRegistration`
    if (!this.dynamicRegistrationEnabled()) {
      return this.fail(new DynamicJobRegistrationDisabledError('job'));
    }

    // A job the caller may not update reads like an unknown one, as remove_job's denial does
    const job = jobRegistry.findByName(input.name);
    const builder = this.scope.authoritiesContextBuilder;
    if (!job || !(await JobPermissionGuard.check(job.metadata.permissions, 'update', this.authInfo, builder))) {
      return this.fail(new JobNotAuthorizedError(input.name));
    }
    if (!job.isDynamic()) {
      return this.fail(new InvalidInputError(`Job "${input.name}" is declared in code and cannot be updated`));
    }

    const record = job.record as JobDynamicRecord;
    const { description, inputSchema, outputSchema, tags } = input;
    jobRegistry.registerDynamic({
      ...record,
      metadata: {
        ...record.metadata,
        ...(description === undefined ? {} : { description }),
        ...(inputSchema === undefined ? {} : { inputSchema: inputSchema as unknown as ToolInputType }),
        ...(outputSchema === undefined ? {} : { outputSchema: outputSchema as unknown as ToolOutputType }),
        ...(tags === undefined ? {} : { tags }),
      },
      script: input.script ?? record.script,
    });

    return { success: true, jobId: record.provide };
  }

  private dynamicRegistrationEnabled(): boolean {
    const jobs = (this.scope.metadata as { jobs?: { allowDynamicRegistration?: boolean } } | undefined)?.jobs;
    return jobs?.allowDynamicRegistration === true;
  }
}
