// file: libs/sdk/src/common/entries/resource.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { AnyResourceRecord } from '../records';
import { ResourceContext, ResourceInterface } from '../interfaces';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { ReadResourceResult, Request, Notification } from '@frontmcp/protocol';
import { RequestHandlerExtra } from '@frontmcp/protocol';
import { AuthInfo } from '@frontmcp/protocol';
import { ProviderRegistryInterface } from '../interfaces/internal';
import type { ResourceArgumentCompleter } from '../interfaces/resource.interface';
import ProviderRegistry from '../../provider/provider.registry';

export type ResourceReadExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
  /**
   * Optional context-aware providers from the flow.
   * @internal
   */
  contextProviders?: ProviderRegistryInterface;
};

export type ParsedResourceResult = ReadResourceResult;
export type ResourceSafeTransformResult<T> = { success: true; data: T } | { success: false; error: Error };

/**
 * Base class for resource entries.
 * @template Params - Type for URI template parameters (e.g., `{ userId: string }`)
 * @template Out - Type for the resource output
 */
export abstract class ResourceEntry<
  Params extends Record<string, string> = Record<string, string>,
  Out = unknown,
> extends BaseEntry<AnyResourceRecord, ResourceInterface<Params, Out>, ResourceMetadata | ResourceTemplateMetadata> {
  owner: EntryOwnerRef;

  /**
   * The name of the resource, as declared in the metadata.
   */
  name: string;

  /**
   * The full name of the resource, including the owner name as prefix.
   */
  fullName: string;

  /**
   * URI for static resources (from ResourceMetadata)
   */
  uri?: string;

  /**
   * URI template for template resources (from ResourceTemplateMetadata)
   */
  uriTemplate?: string;

  /**
   * Whether this resource is a template (has uriTemplate instead of uri)
   */
  isTemplate: boolean;

  /**
   * Get the provider registry for this resource.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  abstract get providers(): ProviderRegistry;

  /**
   * Create a resource context (class or function wrapper).
   * @param uri The actual URI being read (for templates, this includes resolved params)
   * @param params Extracted URI template parameters (empty for static resources)
   * @param ctx Request context with auth info
   */
  abstract create(uri: string, params: Params, ctx: ResourceReadExtra): ResourceContext<Params, Out>;

  /**
   * Convert the raw resource return value (Out) into an MCP ReadResourceResult.
   */
  abstract parseOutput(result: Out): ParsedResourceResult;

  /**
   * Safe version of parseOutput that returns success/error instead of throwing.
   */
  abstract safeParseOutput(raw: Out): ResourceSafeTransformResult<ParsedResourceResult>;

  /**
   * Match a URI against this resource.
   * For static resources: exact match against uri
   * For templates: pattern match and extract parameters
   */
  abstract matchUri(uri: string): { matches: boolean; params: Params };

  /**
   * Get an argument completer for resource template autocompletion.
   * Override in subclasses to provide suggestions for template parameters.
   * Returns null by default (no completion available).
   */
  getArgumentCompleter(_argName: string): ResourceArgumentCompleter | null {
    return null;
  }
}
