import { z } from '@frontmcp/lazy-zod';
import type { FlowRequestInfo } from '@frontmcp/sdk';
import type { StorageConfig } from '@frontmcp/utils';

import { ResultHandlesConfigurationError } from './result-handles.errors';

/** The `_meta` key of a folded answer's handle, its size in bytes and its `ttlSeconds`. */
export const RESULT_HANDLE_META_KEY = 'frontmcp/result-handle';

/** The smallest `thresholdBytes`: a folded answer takes about this much itself. */
export const MIN_THRESHOLD_BYTES = 1024;

/** How many answers a memory store holds at once, dropping the oldest, unless `storage.memory.maxEntries` is set. */
export const DEFAULT_MEMORY_MAX_ENTRIES = 1000;

/** What a fold policy knows about an answer over the threshold. */
export interface FoldContext {
  /** The answer's size: UTF-8 bytes of its JSON. */
  bytes: number;
  /** The tool's full name, its app's id first (`reports:export_rows`). */
  fullName: string;
  /** The request the answer goes back to: its session, client and headers. */
  request: FlowRequestInfo;
}

/** Whether an answer over the threshold folds; `answer` is its `structuredContent`, or its text. */
export type FoldPolicy = (toolName: string, answer: unknown, context: FoldContext) => boolean;

export interface ResultHandlesPluginOptionsInput {
  /** Answers whose data is larger than this, as UTF-8 JSON, fold (16384 by default, at least 1024). */
  thresholdBytes?: number;
  /** How long a folded answer can be read, in seconds (600 by default). */
  ttlSeconds?: number;
  /** The first `items` of each list and `chars` of each string the preview keeps ({ items: 5, chars: 500 }). */
  preview?: { items?: number; chars?: number };
  /** Which answers over the threshold fold (every one by default). */
  foldPolicy?: FoldPolicy;
  /** Where folded answers are kept, through `createStorage()` from `@frontmcp/utils` ({ type: 'auto' }, 1000 at most in memory). */
  storage?: StorageConfig;
  /** The key prefix of folded answers in the storage ('result-handles'). */
  namespace?: string;
}

export interface ResultHandlesPluginOptions {
  thresholdBytes: number;
  ttlSeconds: number;
  preview: { items: number; chars: number };
  foldPolicy: FoldPolicy;
  storage: StorageConfig;
  namespace: string;
}

const foldEverything: FoldPolicy = () => true;

const wholeNumberAtLeastOne = { message: 'must be a whole number, at least 1' };

const resultHandlesOptionsSchema = z
  .object({
    thresholdBytes: z
      .number()
      .int({ message: `must be a whole number of at least ${MIN_THRESHOLD_BYTES}` })
      .min(MIN_THRESHOLD_BYTES, { message: `must be a whole number of at least ${MIN_THRESHOLD_BYTES}` })
      .default(16 * 1024),
    ttlSeconds: z
      .number()
      .int({ message: 'must be a whole number of seconds, at least 1' })
      .min(1, { message: 'must be a whole number of seconds, at least 1' })
      .default(600),
    preview: z
      .object({
        items: z.number().int(wholeNumberAtLeastOne).min(1, wholeNumberAtLeastOne).default(5),
        chars: z.number().int(wholeNumberAtLeastOne).min(1, wholeNumberAtLeastOne).default(500),
      })
      .strict()
      .default({ items: 5, chars: 500 }),
    foldPolicy: z
      .custom<FoldPolicy>((value) => typeof value === 'function', {
        message: 'must be a function (toolName, answer, context) => boolean',
      })
      .default(() => foldEverything),
    storage: z
      .custom<StorageConfig>((value) => typeof value === 'object' && value !== null && !Array.isArray(value), {
        message: 'must be a storage config, such as { type: "redis", redis: { url } }',
      })
      .default({ type: 'auto' })
      .transform((storage) => ({ ...storage, memory: { maxEntries: DEFAULT_MEMORY_MAX_ENTRIES, ...storage.memory } })),
    namespace: z.string().min(1, { message: 'must not be empty' }).default('result-handles'),
  })
  .strict();

/** The plugin's options with their defaults, or a {@link ResultHandlesConfigurationError} naming each problem. */
export function parseResultHandlesOptions(input: ResultHandlesPluginOptionsInput): ResultHandlesPluginOptions {
  const { providers, ...options } = input as ResultHandlesPluginOptionsInput & { providers?: unknown };
  const result = resultHandlesOptionsSchema.safeParse(Array.isArray(providers) ? options : input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
  throw new ResultHandlesConfigurationError(`Invalid ResultHandlesPlugin options: ${problems.join('; ')}`);
}
