import type { ReferenceEntry } from '@enclave-vm/core/worker';

import type { ResultOwner } from '@frontmcp/plugin-result-handles';
import type { FrontMcpLogger } from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

import { createPublicToolCallError, createToolCallError, TOOL_CALL_ERROR_CODES, type ToolCallError } from '../errors';
import { KEEP_CALL_NAME, MAX_KEPT_NAME_CHARS, RECALL_CALL_NAME, withKeptValueFunctions } from './kept-value-script';
import type { KeptValueStore } from './kept-value.store';
import type { KeptValue } from './kept-value.types';

const NO_OWNER = 'keep and recall need a session or a signed-in caller to keep values for, and this call has neither';

const encoder = new TextEncoder();

export interface KeptValueCallsOptions {
  store: KeptValueStore;
  /** Whose values the run keeps and recalls: the session and the signed-in subject it runs for. */
  owner: ResultOwner;
  /** The UTF-8 bytes from which a kept string is kept as a sidecar reference; unset while the sidecar is off. */
  referenceThreshold?: number;
  logger?: FrontMcpLogger;
}

/** What a run executes with `keep` and `recall`: the script, and the sidecar entries it starts with. */
export interface KeptValueRun {
  script: string;
  preloadReferences: ReferenceEntry[];
}

/** `keep(name, value)` and `recall(name)` for one run, for the owner it runs for. */
export class KeptValueCalls {
  private readonly preloadedTokens = new Set<string>();

  constructor(private readonly options: KeptValueCallsOptions) {}

  /** The script with `keep` and `recall`, and the large values it recalls by a literal name, as sidecar entries. */
  async prepare(code: string): Promise<KeptValueRun> {
    const { script, recalledNames } = withKeptValueFunctions(code);
    const { store, owner, referenceThreshold } = this.options;
    if (referenceThreshold === undefined || recalledNames.length === 0 || !hasOwner(owner)) {
      return { script, preloadReferences: [] };
    }
    try {
      const preloadReferences = await store.referencesOf(owner, recalledNames);
      for (const entry of preloadReferences) this.preloadedTokens.add(entry.id);
      return { script, preloadReferences };
    } catch (error: unknown) {
      this.warnStoreFailed(error);
      return { script, preloadReferences: [] };
    }
  }

  /** Answers a `keep` (undefined once kept) or a `recall` (the value, or undefined for a name nothing is kept under). */
  async call(callName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!hasOwner(this.options.owner))
      throw createPublicToolCallError(TOOL_CALL_ERROR_CODES.ACCESS_DENIED, callName, NO_OWNER);
    const { name, value } = args;
    if (typeof name !== 'string' || name.length === 0 || name.length > MAX_KEPT_NAME_CHARS) {
      throw createPublicToolCallError(
        TOOL_CALL_ERROR_CODES.VALIDATION,
        callName,
        `The name must be a string of 1 to ${MAX_KEPT_NAME_CHARS} characters`,
      );
    }
    return callName === KEEP_CALL_NAME ? this.keep(name, value) : this.recall(name);
  }

  private async keep(name: string, value: unknown): Promise<undefined> {
    if (value === undefined) {
      throw createPublicToolCallError(
        TOOL_CALL_ERROR_CODES.VALIDATION,
        KEEP_CALL_NAME,
        'keep(name, value) needs a value to keep',
      );
    }
    try {
      await this.options.store.keep(this.options.owner, name, this.keptValueOf(value));
    } catch (error: unknown) {
      if (error instanceof RangeError) {
        throw createPublicToolCallError(TOOL_CALL_ERROR_CODES.RESULT_TOO_LARGE, KEEP_CALL_NAME, error.message);
      }
      throw this.storeFailure(KEEP_CALL_NAME, error);
    }
    return undefined;
  }

  private async recall(name: string): Promise<unknown> {
    let kept: KeptValue | undefined;
    try {
      kept = await this.options.store.recall(this.options.owner, name);
    } catch (error: unknown) {
      throw this.storeFailure(RECALL_CALL_NAME, error);
    }
    if (!kept) return undefined;
    if ('value' in kept) return kept.value;
    return this.preloadedTokens.has(kept.reference.id) ? kept.reference.id : kept.reference.data;
  }

  /** A large string as a sidecar entry under a token of its own, which a later run's sidecar starts with. */
  private keptValueOf(value: unknown): KeptValue {
    const { referenceThreshold } = this.options;
    const isLarge =
      typeof value === 'string' &&
      referenceThreshold !== undefined &&
      encoder.encode(value).byteLength >= referenceThreshold;
    if (!isLarge) return { value };
    return { reference: { id: `__REF_${randomUUID()}__`, data: value, source: 'tool-result', origin: KEEP_CALL_NAME } };
  }

  private storeFailure(callName: string, error: unknown): ToolCallError {
    this.warnStoreFailed(error);
    return createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, callName);
  }

  private warnStoreFailed(error: unknown): void {
    this.options.logger?.warn('codecall: the kept-value store failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function hasOwner(owner: ResultOwner): boolean {
  return owner.session !== undefined || owner.caller !== undefined;
}
