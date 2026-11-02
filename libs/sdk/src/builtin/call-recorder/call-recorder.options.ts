import { z } from '@frontmcp/lazy-zod';

import { CallRecorderConfigurationError } from '../../errors';
import { RECORDED_METHODS, type RecordedMethod } from './call-record';

export interface CallRecorderPluginOptionsInput {
  /** The JSONL file each call is appended to ('.frontmcp/calls.jsonl' by default). */
  path?: string;
  /** The calls to record (all of them by default). */
  methods?: RecordedMethod[];
  /** More fields written as '[REDACTED]' (case-insensitive); fields named like a credential always are. */
  redactFields?: string[];
  /** Fields named like a credential that are safe to record, such as the `key` of a key-value tool. */
  keepFields?: string[];
  /** The file stops growing at this size: later calls are not recorded (10 MiB by default). */
  maxBytes?: number;
}

export interface CallRecorderPluginOptions {
  path: string;
  methods: RecordedMethod[];
  redactFields: string[];
  keepFields: string[];
  maxBytes: number;
}

const fieldNames = z.array(z.string().min(1, { message: 'must not be empty' })).default([]);

const callRecorderOptionsSchema = z
  .object({
    path: z.string().min(1, { message: 'must be a file path' }).default('.frontmcp/calls.jsonl'),
    methods: z
      .array(z.enum(RECORDED_METHODS, { message: `must be one of ${RECORDED_METHODS.join(', ')}` }))
      .min(1, { message: 'must name at least one method' })
      .default([...RECORDED_METHODS]),
    redactFields: fieldNames,
    keepFields: fieldNames,
    maxBytes: z
      .number()
      .int({ message: 'must be a whole number of bytes, at least 1' })
      .min(1, { message: 'must be a whole number of bytes, at least 1' })
      .default(10 * 1024 * 1024),
  })
  .strict();

/** The plugin's options with their defaults, or a {@link CallRecorderConfigurationError} naming each problem. */
export function parseCallRecorderOptions(input: CallRecorderPluginOptionsInput): CallRecorderPluginOptions {
  const result = callRecorderOptionsSchema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
  throw new CallRecorderConfigurationError(`Invalid CallRecorderPlugin options: ${problems.join('; ')}`);
}
