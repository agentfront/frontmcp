import { internalZ as z } from '@frontmcp/lazy-zod';
import { IconSchema, type Icon } from '@frontmcp/protocol';
import { entryAvailabilitySchema, isValidMcpUri, isValidMcpUriTemplate, type EntryAvailability } from '@frontmcp/utils';

import { type RawZodShape } from '../types';
import { enabledOptionSchema, type EnabledOption } from './enabled.metadata';
import { resourceKeySchema, type ResourceKey } from './materialized.metadata';

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
 * MCP `Annotations` object on a resource. Mirrors the MCP spec's
 * `Annotations` shape — used to give hosts hints about audience,
 * priority, and modification time.
 */
export interface ResourceAnnotations {
  /**
   * The intended consumer(s). E.g. `["assistant"]` for content the model
   * should load, `["user", "assistant"]` for content the host may show in
   * a UI as well.
   */
  audience?: Array<'user' | 'assistant'>;
  /**
   * Display priority hint in the range [0, 1]. Higher values surface
   * earlier under progressive disclosure. SEP-2640 recommends 0.8 for
   * the primary `SKILL.md` and ~0.3 for support files.
   */
  priority?: number;
  /** ISO 8601 timestamp of the last modification. Useful for cache invalidation. */
  lastModified?: string;
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

  /**
   * MCP annotations for the resource. Forwarded verbatim in
   * `resources/list` so hosts can route based on `audience`, `priority`,
   * and `lastModified`.
   */
  annotations?: ResourceAnnotations;

  /**
   * Free-form metadata forwarded in `resources/list` and `resources/read`
   * responses. Reserve reverse-DNS prefixed keys (e.g.
   * `io.modelcontextprotocol.skills/...`) per the MCP spec.
   */
  _meta?: Record<string, unknown>;

  /**
   * Environment availability constraint.
   * When set, the resource is only discoverable and readable in matching environments.
   */
  availableWhen?: EntryAvailability;

  /**
   * Whether the resource is on: a boolean, or an `EnabledSource` such as `fileSignal(path, key)` that can change
   * while sessions are live. A resource that is off is left out of `resources/list`, and `resources/read` refuses it with
   * `FEATURE_OFF` and a remedy. When a source changes, connected clients get `notifications/resources/list_changed`.
   */
  enabled?: EnabledOption;

  /**
   * The resource store key whose value this resource serves (`resourceStore().key(name)`). FrontMCP answers
   * `resources/subscribe` for it and sends `notifications/resources/updated` whenever its revision changes, from a
   * write in any process that shares the store. Extend `MaterializedResourceContext` to serve the value as it is.
   */
  from?: ResourceKey;

  /**
   * Run `read` in a worker thread of the server's offload pool (Node only), so CPU-heavy work does not block the server.
   * The worker imports the module that declares the resource and builds the resource there, without a DI container:
   * `this.get()`, `this.scope`, `this.auth` and the request context throw there. It gets the URI and its parameters, and
   * sends back the output by structured clone. `{ budgetMs }` bounds how long it may run (default `offload.budgetMs`);
   * past it the read is refused with `OffloadBudgetExceededError`.
   */
  worker?: ResourceWorkerOption;
}

/** `true`, or the budget of each read in the worker. */
export type ResourceWorkerOption = boolean | { budgetMs?: number };

const resourceWorkerOptionSchema = z.union([
  z.boolean(),
  z
    .object({
      budgetMs: z
        .number({ message: 'worker.budgetMs must be a number of milliseconds' })
        .int('worker.budgetMs must be a whole number of milliseconds')
        .positive('worker.budgetMs must be greater than 0')
        .optional(),
    })
    .strict(),
]);

const resourceAnnotationsSchema = z
  .object({
    audience: z.array(z.enum(['user', 'assistant'])).optional(),
    priority: z.number().min(0).max(1).optional(),
    lastModified: z.string().optional(),
  })
  .strict();

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
    annotations: resourceAnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
    availableWhen: entryAvailabilitySchema.optional(),
    enabled: enabledOptionSchema.optional(),
    from: resourceKeySchema.optional(),
    worker: resourceWorkerOptionSchema.optional(),
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

  /**
   * MCP annotations for the template. Same shape as resource annotations
   * — clients use these to route by audience/priority and invalidate
   * caches via `lastModified`.
   */
  annotations?: ResourceAnnotations;

  /**
   * Free-form metadata forwarded in `resources/list` responses; reserve
   * reverse-DNS prefixed keys per the MCP spec.
   */
  _meta?: Record<string, unknown>;

  /**
   * Environment availability constraint.
   * When set, the resource template is only discoverable in matching environments.
   */
  availableWhen?: EntryAvailability;

  /**
   * Whether the template is on: a boolean, or an `EnabledSource` such as `fileSignal(path, key)` that can change
   * while sessions are live. A template that is off is left out of `resources/templates/list`, and `resources/read` refuses it with
   * `FEATURE_OFF` and a remedy. When a source changes, connected clients get `notifications/resources/list_changed`.
   */
  enabled?: EnabledOption;

  /** Read in a worker thread of the offload pool; see `ResourceMetadata.worker`. */
  worker?: ResourceWorkerOption;
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
    annotations: resourceAnnotationsSchema.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
    availableWhen: entryAvailabilitySchema.optional(),
    enabled: enabledOptionSchema.optional(),
    worker: resourceWorkerOptionSchema.optional(),
  } satisfies RawZodShape<ResourceTemplateMetadata, ExtendFrontMcpResourceTemplateMetadata>)
  .passthrough()
  .refine((metadata) => !('from' in metadata), {
    message: '`from` serves one stored value at a fixed `uri`: declare it on @Resource, not on @ResourceTemplate',
    path: ['from'],
  });

export {
  ResourceMetadata,
  ResourceMetadata as FrontMcpResourceMetadata,
  ResourceTemplateMetadata,
  ResourceTemplateMetadata as FrontMcpResourceTemplateMetadata,
};
