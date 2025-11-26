// file: libs/sdk/src/common/entries/prompt.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { PromptRecord } from '../records';
import { PromptContext, PromptInterface, Type } from '../interfaces';
import { PromptMetadata } from '../metadata';
import { GetPromptResult, Request, Notification } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// Union type covers both class and function-based prompts
export type AnyPromptRecord =
  | PromptRecord
  | {
      kind: string;
      // Type<unknown> for class-based prompts, generic function signature for function-based prompts
      provide: Type<unknown> | ((...args: unknown[]) => unknown);
      metadata: PromptMetadata;
    };

export type PromptGetExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
};

export type ParsedPromptResult = GetPromptResult;
export type PromptSafeTransformResult<T> = { success: true; data: T } | { success: false; error: Error };

export abstract class PromptEntry extends BaseEntry<AnyPromptRecord, PromptInterface, PromptMetadata> {
  owner!: EntryOwnerRef;

  /**
   * The name of the prompt, as declared in the metadata.
   */
  name!: string;

  /**
   * The full name of the prompt, including the owner name as prefix.
   */
  fullName!: string;

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
