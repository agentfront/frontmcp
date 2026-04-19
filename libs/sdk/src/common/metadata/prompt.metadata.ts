import { z } from '@frontmcp/lazy-zod';
import { IconSchema, type Icon } from '@frontmcp/protocol';
import { entryAvailabilitySchema, type EntryAvailability } from '@frontmcp/utils';

import { type RawZodShape } from '../types';

declare global {
  /**
   * Declarative metadata extends to McpPrompt decorator.
   */
  export interface ExtendFrontMcpPromptMetadata {}
}

interface PromptArgument {
  /**
   * The name of the argument.
   */
  name: string;
  /**
   * A human-readable description of the argument.
   */
  description?: string;
  /**
   * Whether this argument must be provided.
   */
  required?: boolean;
}

const promptArgumentSchema = z
  .object({
    /**
     * The name of the argument.
     */
    name: z.string(),
    /**
     * A human-readable description of the argument.
     */
    description: z.optional(z.string()),
    /**
     * Whether this argument must be provided.
     */
    required: z.optional(z.boolean()),
  })
  .passthrough();

/**
 * A known resource that the server is capable of reading.
 */
export interface FrontMcpPromptMetadata extends ExtendFrontMcpPromptMetadata {
  /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
  name: string;
  /**
   * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
   * even by those unfamiliar with domain-specific terminology.
   *
   * If not provided, the name should be used for display (except for Tool,
   * where `annotations.title` should be given precedence over using `name`,
   * if present).
   */
  title?: string;

  /**
   * A description of what this resource represents.
   *
   * Clients can use this to improve the LLM's understanding of available resources. It can be thought of as a "hint" to the model.
   */
  description?: string;

  /**
   * A list of arguments to use for templating the prompt.
   */
  arguments: PromptArgument[];

  /**
   * A list of icons that can be used to represent this resource template.
   */
  icons?: Icon[];

  /**
   * Environment availability constraint.
   * When set, the prompt is only discoverable and usable in matching environments.
   */
  availableWhen?: EntryAvailability;
}

export const frontMcpPromptMetadataSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    arguments: z.array(promptArgumentSchema).optional(),
    icons: z.array(IconSchema).optional(),
    availableWhen: entryAvailabilitySchema.optional(),
  } satisfies RawZodShape<FrontMcpPromptMetadata, ExtendFrontMcpPromptMetadata>)
  .passthrough();

export { FrontMcpPromptMetadata as PromptMetadata };
