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
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { matchUriTemplate, parseUriTemplate, buildParsedResourceResult } from './resource.utils';
import { ResourceTemplateRecord, ResourceTemplateKind } from './resource.types';

export class ResourceInstance<In = any, Out = any> extends ResourceEntry<In, Out> {
  private readonly providers: ProviderRegistry;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  /** Parsed URI template info for template resources */
  private templateInfo?: { pattern: RegExp; paramNames: string[] };

  constructor(record: ResourceRecord | ResourceTemplateRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

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
    // Register hooks for resources:read-resource, resources:list-resources flows
    const hooks = normalizeHooksFromCls(this.record.provide).filter(
      (hook) =>
        hook.metadata.flow === 'resources:read-resource' ||
        hook.metadata.flow === 'resources:list-resources' ||
        hook.metadata.flow === 'resources:list-resource-templates',
    );
    if (hooks.length > 0) {
      await this.hooks.registerHooks(true, ...hooks);
    }
  }

  getMetadata(): ResourceMetadata | ResourceTemplateMetadata {
    return this.record.metadata;
  }

  /**
   * Match a URI against this resource.
   * For static resources: exact match against uri
   * For templates: pattern match and extract parameters
   */
  override matchUri(uri: string): { matches: boolean; params: Record<string, string> } {
    if (this.isTemplate && this.templateInfo && this.uriTemplate) {
      const params = matchUriTemplate(this.uriTemplate, uri);
      if (params) {
        return { matches: true, params };
      }
      return { matches: false, params: {} };
    }

    // Static resource: exact match
    if (this.uri === uri) {
      return { matches: true, params: {} };
    }
    return { matches: false, params: {} };
  }

  /**
   * Create a resource context (class or function wrapper).
   */
  override create(uri: string, params: Record<string, string>, ctx: ResourceReadExtra): ResourceContext<In, Out> {
    const metadata = this.metadata;
    const providers = this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const resourceCtorArgs: ResourceCtorArgs = {
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
        return new (record.provide as unknown as new (args: ResourceCtorArgs) => ResourceContext<In, Out>)(
          resourceCtorArgs,
        );
      case ResourceKind.FUNCTION:
      case ResourceTemplateKind.FUNCTION:
        return new FunctionResourceContext<In, Out>(record as ResourceFunctionRecord, resourceCtorArgs);
      default:
        // This should be unreachable if all ResourceKind and ResourceTemplateKind values are handled
        throw new Error(`Unhandled resource kind: ${(record as any).kind}`);
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
    } catch (error: any) {
      return { success: false, error };
    }
  }
}

/**
 * Resource context for function-decorated resources.
 */
class FunctionResourceContext<In = any, Out = any> extends ResourceContext<In, Out> {
  constructor(private readonly record: ResourceFunctionRecord, args: ResourceCtorArgs) {
    super(args);
  }

  execute(uri: string, params: Record<string, string>): Promise<Out> {
    return this.record.provide(uri, params, this);
  }
}
