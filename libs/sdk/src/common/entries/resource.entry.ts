// file: libs/sdk/src/common/entries/resource.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { AnyResourceRecord } from '../records';
import { ResourceContext, ResourceInterface } from '../interfaces';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { ReadResourceResult, Request, Notification } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ProviderRegistryInterface } from '../interfaces/internal';

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
}
