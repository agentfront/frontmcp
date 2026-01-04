import { z } from 'zod';
import { RawZodShape } from '../types';
import { Icon, IconSchema } from '@modelcontextprotocol/sdk/types.js';
import { isValidMcpUri, isValidMcpUriTemplate } from '@frontmcp/utils';

declare global {
  /**
   * Declarative metadata extends to McpResource decorator.
   */
  export interface ExtendFrontMcpResourceMetadata {}

  /**
   * Declarative metadata extends to McpResourceTemplate decorator.
   */
  export interface ExtendFrontMcpResourceTemplateMetadata {}
}

/**
 * A known resource that the server is capable of reading.
 */
interface ResourceMetadata extends ExtendFrontMcpResourceMetadata {
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
   * The URI of this resource.
   */
  uri: string;

  /**
   * A description of what this resource represents.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description?: string;

  /**
   * The MIME type of this resource, if known.
   */
  mimeType?: string;

  /**
   * A list of icons that can be used to represent this resource template.
   */
  icons?: Icon[];
}

export const frontMcpResourceMetadataSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    uri: z.string().min(1).refine(isValidMcpUri, {
      message: 'URI must have a valid scheme (e.g., file://, https://, custom://)',
    }),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    icons: z.array(IconSchema).optional(),
  } satisfies RawZodShape<ResourceMetadata, ExtendFrontMcpResourceMetadata>)
  .passthrough();

/**
 * A template description for resources available on the server.
 */
interface ResourceTemplateMetadata extends ExtendFrontMcpResourceTemplateMetadata {
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
   * A URI template (according to RFC 6570) that can be used to construct resource URIs.
   */
  uriTemplate: string;

  /**
   * A description of what this template is for.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description?: string;

  /**
   * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
   */
  mimeType?: string;

  /**
   * A list of icons that can be used to represent this resource template.
   */
  icons?: Icon[];
}

export const frontMcpResourceTemplateMetadataSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    uriTemplate: z.string().min(1).refine(isValidMcpUriTemplate, {
      message: 'URI template must have a valid scheme (e.g., file://, https://, custom://)',
    }),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    icons: z.array(IconSchema).optional(),
  } satisfies RawZodShape<ResourceTemplateMetadata, ExtendFrontMcpResourceTemplateMetadata>)
  .passthrough();

export {
  ResourceMetadata,
  ResourceMetadata as FrontMcpResourceMetadata,
  ResourceTemplateMetadata,
  ResourceTemplateMetadata as FrontMcpResourceTemplateMetadata,
};
