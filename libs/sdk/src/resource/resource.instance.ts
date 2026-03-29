// file: libs/sdk/src/resource/resource.instance.ts

import {
  EntryOwnerRef,
  ResourceEntry,
  ResourceReadExtra,
  ParsedResourceResult,
  ResourceSafeTransformResult,
  ResourceRecord,
  ResourceKind,
  ResourceContext,
  ResourceCtorArgs,
  ResourceMetadata,
  ResourceTemplateMetadata,
  ResourceFunctionRecord,
  ResourceTemplateRecord,
  ResourceTemplateKind,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import HookRegistry from '../hooks/hook.registry';
import { ScopeEntry } from '../common';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { matchUriTemplate, parseUriTemplate } from '@frontmcp/utils';
import { buildResourceContent as buildParsedResourceResult } from '../utils/content.utils';
import { InvalidHookFlowError } from '../errors/mcp.error';
import { InvalidRegistryKindError } from '../errors';

export class ResourceInstance<
  Params extends Record<string, string> = Record<string, string>,
  Out = unknown,
> extends ResourceEntry<Params, Out> {
  private readonly _providers: ProviderRegistry;
  readonly scope: ScopeEntry;
  readonly hooks: HookRegistry;

  /**
   * Get the provider registry for this resource.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  get providers(): ProviderRegistry {
    return this._providers;
  }

  /** Parsed URI template info for template resources */
  private templateInfo?: { pattern: RegExp; paramNames: string[] };

  constructor(record: ResourceRecord | ResourceTemplateRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.hooks;

    // Determine if this is a template resource
    this.isTemplate = 'uriTemplate' in record.metadata;

    if (this.isTemplate) {
      const templateMetadata = record.metadata as ResourceTemplateMetadata;
      this.uriTemplate = templateMetadata.uriTemplate;
      // Pre-parse the URI template for efficient matching
      this.templateInfo = parseUriTemplate(this.uriTemplate);
    } else {
      const resourceMetadata = record.metadata as ResourceMetadata;
      this.uri = resourceMetadata.uri;
    }

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    // Valid flows for resource hooks
    const validFlows = ['resources:read-resource', 'resources:list-resources', 'resources:list-resource-templates'];

    const allHooks = normalizeHooksFromCls(this.record.provide);

    // Separate valid and invalid hooks
    const validHooks = allHooks.filter((hook) => validFlows.includes(hook.metadata.flow));
    const invalidHooks = allHooks.filter((hook) => !validFlows.includes(hook.metadata.flow));

    // Throw error for invalid hooks (fail fast)
    if (invalidHooks.length > 0) {
      const className = (this.record.provide as any)?.name ?? 'Unknown';
      const invalidFlowNames = invalidHooks.map((h) => h.metadata.flow).join(', ');
      throw new InvalidHookFlowError(
        `Resource "${className}" has hooks for unsupported flows: ${invalidFlowNames}. ` +
          `Only resource flows (${validFlows.join(', ')}) are supported on resource classes.`,
      );
    }

    // Register valid hooks
    if (validHooks.length > 0) {
      await this.hooks.registerHooks(true, ...validHooks);
    }
  }

  getMetadata(): ResourceMetadata | ResourceTemplateMetadata {
    return this.record.metadata;
  }

  /**
   * Get an argument completer from the resource class prototype.
   * Returns a completer function if the resource class overrides getArgumentCompleter,
   * or null if no completer is available.
   */
  override getArgumentCompleter(
    argName: string,
  ):
    | ((
        partial: string,
      ) =>
        | Promise<{ values: string[]; total?: number; hasMore?: boolean }>
        | { values: string[]; total?: number; hasMore?: boolean })
    | null {
    const cls = this.record.provide;
    if (typeof cls === 'function' && cls.prototype && typeof cls.prototype.getArgumentCompleter === 'function') {
      // Call the method on the prototype — it doesn't need instance state for static completions
      // For dynamic completions that need DI, the method should be overridden at instance level
      return cls.prototype.getArgumentCompleter.call(cls.prototype, argName);
    }
    return null;
  }

  /**
   * Match a URI against this resource.
   * For static resources: exact match against uri
   * For templates: pattern match and extract parameters
   */
  override matchUri(uri: string): { matches: boolean; params: Params } {
    if (this.isTemplate && this.templateInfo && this.uriTemplate) {
      const params = matchUriTemplate(this.uriTemplate, uri);
      if (params) {
        return { matches: true, params: params as Params };
      }
      return { matches: false, params: {} as Params };
    }

    // Static resource: exact match
    if (this.uri === uri) {
      return { matches: true, params: {} as Params };
    }
    return { matches: false, params: {} as Params };
  }

  /**
   * Create a resource context (class or function wrapper).
   */
  override create(uri: string, params: Params, ctx: ResourceReadExtra): ResourceContext<Params, Out> {
    const metadata = this.metadata;
    // Use context-aware providers from flow if available
    const providers = ctx.contextProviders ?? this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const resourceCtorArgs: ResourceCtorArgs<Params> = {
      metadata,
      uri,
      params,
      providers,
      logger,
      authInfo,
    };

    const record = this.record as ResourceRecord | ResourceTemplateRecord;

    switch (record.kind) {
      case ResourceKind.CLASS_TOKEN:
      case ResourceTemplateKind.CLASS_TOKEN:
        return new (record.provide as unknown as new (args: ResourceCtorArgs<Params>) => ResourceContext<Params, Out>)(
          resourceCtorArgs,
        );
      case ResourceKind.FUNCTION:
      case ResourceTemplateKind.FUNCTION:
        return new FunctionResourceContext<Params, Out>(record as ResourceFunctionRecord, resourceCtorArgs);
      default:
        // This should be unreachable if all ResourceKind and ResourceTemplateKind values are handled
        throw new InvalidRegistryKindError('resource', (record as any).kind);
    }
  }

  /**
   * Convert the raw resource return value into an MCP ReadResourceResult.
   */
  override parseOutput(raw: Out): ParsedResourceResult {
    const uri = this.isTemplate ? this.uriTemplate! : this.uri!;
    const mimeType = this.metadata.mimeType;

    // If raw is already in ReadResourceResult format
    if (raw && typeof raw === 'object' && 'contents' in raw) {
      return raw as unknown as ParsedResourceResult;
    }

    // If raw is an array, assume it's an array of content items
    if (Array.isArray(raw)) {
      const contents = raw.map((item, index) => {
        if (item && typeof item === 'object' && ('text' in item || 'blob' in item)) {
          const itemUri = ((item as Record<string, unknown>)['uri'] as string | undefined) || `${uri}#${index}`;
          const itemMimeType = ((item as Record<string, unknown>)['mimeType'] as string | undefined) || mimeType;
          if ('text' in item) {
            return { uri: itemUri, mimeType: itemMimeType, text: (item as Record<string, unknown>)['text'] as string };
          }
          return { uri: itemUri, mimeType: itemMimeType, blob: (item as Record<string, unknown>)['blob'] as string };
        }
        return buildParsedResourceResult(`${uri}#${index}`, item, mimeType);
      });
      return { contents };
    }

    // Single content item
    const content = buildParsedResourceResult(uri, raw, mimeType);
    return { contents: [content] };
  }

  /**
   * Safe version of parseOutput that returns success/error instead of throwing.
   */
  override safeParseOutput(raw: Out): ResourceSafeTransformResult<ParsedResourceResult> {
    try {
      return { success: true, data: this.parseOutput(raw) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

/**
 * Resource context for function-decorated resources.
 */
class FunctionResourceContext<
  Params extends Record<string, string> = Record<string, string>,
  Out = unknown,
> extends ResourceContext<Params, Out> {
  constructor(
    private readonly record: ResourceFunctionRecord,
    args: ResourceCtorArgs<Params>,
  ) {
    super(args);
  }

  execute(uri: string, params: Params): Promise<Out> {
    return this.record.provide(uri, params, this);
  }
}
