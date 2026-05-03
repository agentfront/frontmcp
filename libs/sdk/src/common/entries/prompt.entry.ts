// file: libs/sdk/src/common/entries/prompt.entry.ts

import {
  type AuthInfo,
  type GetPromptResult,
  type Notification,
  type Request,
  type RequestHandlerExtra,
} from '@frontmcp/protocol';

import type ProviderRegistry from '../../provider/provider.registry';
import { type PromptContext, type PromptInterface } from '../interfaces';
import { type ProviderRegistryInterface } from '../interfaces/internal';
import { type PromptMetadata } from '../metadata';
import { type PromptRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

export type PromptGetExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
  /**
   * Optional context-aware providers from the flow.
   * @internal
   */
  contextProviders?: ProviderRegistryInterface;
};

export type ParsedPromptResult = GetPromptResult;
export type PromptSafeTransformResult<T> = { success: true; data: T } | { success: false; error: Error };

export abstract class PromptEntry extends BaseEntry<PromptRecord, PromptInterface, PromptMetadata> {
  owner: EntryOwnerRef;

  /**
   * The name of the prompt, as declared in the metadata.
   */
  name: string;

  /**
   * The full name of the prompt, including the owner name as prefix.
   */
  fullName: string;

  /**
   * Get the provider registry for this prompt.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  abstract get providers(): ProviderRegistry;

  /**
   * Create a prompt context (class or function wrapper).
   * @param args Arguments passed to the prompt
   * @param ctx Request context with auth info
   */
  abstract create(args: Record<string, string>, ctx: PromptGetExtra): PromptContext;

  /**
   * Parse and validate arguments against the prompt's argument definitions.
   * @param args Arguments from the MCP request
   * @returns Validated arguments
   */
  abstract parseArguments(args?: Record<string, string>): Record<string, string>;

  /**
   * Convert the raw prompt return value into an MCP GetPromptResult.
   * Accepts any raw output from the prompt execute method and normalizes it.
   */
  abstract parseOutput(raw: unknown): ParsedPromptResult;

  /**
   * Safe version of parseOutput that returns success/error instead of throwing.
   */
  abstract safeParseOutput(raw: unknown): PromptSafeTransformResult<ParsedPromptResult>;
}
