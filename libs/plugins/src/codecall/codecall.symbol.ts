// file: libs/plugins/src/codecall/codecall.symbol.ts

import { CodeCallPluginOptions, CodeCallVmPreset } from './codecall.types';
import { Token } from '@frontmcp/sdk';

export const CodeCallConfig: Token<CodeCallPluginOptions> = Symbol.for('CodeCallConfig');

export interface CodeCallAstValidationIssue {
  kind: 'IllegalBuiltinAccess' | 'DisallowedGlobal' | 'DisallowedLoop' | 'ParseError';
  message: string;
  location?: { line: number; column: number };
  identifier?: string;
}

export interface CodeCallAstValidationResult {
  ok: boolean;
  issues: CodeCallAstValidationIssue[];
}

/**
 * Resolved VM options with all defaults applied.
 * Plugins compute this once and pass into providers.
 */
export interface ResolvedCodeCallVmOptions {
  preset: CodeCallVmPreset;
  timeoutMs: number;
  allowLoops: boolean;
  maxSteps?: number;
  disabledBuiltins: string[];
  disabledGlobals: string[];
  allowConsole: boolean;
}

export interface CodeCallAstValidator {
  /**
   * Validate a JS script before it hits the VM.
   * Should catch syntax errors + illegal identifiers/loops.
   */
  validate(script: string): CodeCallAstValidationResult;
}

/**
 * Environment available to code running inside the VM.
 * The plugin is responsible for wiring this to the underlying tool pipeline.
 */
export interface CodeCallVmEnvironment {
  callTool: <TInput, TResult>(name: string, input: TInput) => Promise<TResult>;

  getTool: (name: string) =>
    | {
        name: string;
        description?: string;
        inputSchema: unknown;
        outputSchema?: unknown | null;
      }
    | undefined;

  codecallContext: Readonly<Record<string, unknown>>;

  console?: Console;

  mcpLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => void;

  mcpNotify?: (event: string, payload: Record<string, unknown>) => void;
}
