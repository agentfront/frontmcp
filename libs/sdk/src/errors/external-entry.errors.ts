import { MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/** The entry kinds that have `.esm()` and `.remote()` factories. */
export type ExternalEntryKind = 'tool' | 'resource' | 'prompt' | 'agent' | 'skill' | 'job';

function describeEntry(entryKind: ExternalEntryKind, targetName: string | undefined, capitalized = true): string {
  const label = capitalized ? entryKind.charAt(0).toUpperCase() + entryKind.slice(1) : entryKind;
  return targetName === undefined ? `${label}s` : `${label} "${targetName}"`;
}

/** A startup error for a `.esm()` / `.remote()` entry, naming its kind, its target and its package or server URL. */
export abstract class ExternalEntryError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;
  readonly entryKind: ExternalEntryKind;
  /** The entry's name in its source; `undefined` for a package specifier string, which takes every entry. */
  readonly targetName?: string;
  readonly source: string;

  protected constructor(
    message: string,
    code: string,
    entryKind: ExternalEntryKind,
    targetName: string | undefined,
    source: string,
  ) {
    super(message, code, 500);
    this.entryKind = entryKind;
    this.targetName = targetName;
    this.source = source;
  }

  toJsonRpcError(): {
    code: number;
    message: string;
    data: { entryKind: ExternalEntryKind; targetName?: string; source: string };
  } {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: { entryKind: this.entryKind, targetName: this.targetName, source: this.source },
    };
  }
}

/** The package of a `.esm()` entry failed to load, or the server of a `.remote()` entry was unreachable. */
export class ExternalEntryLoadError extends ExternalEntryError {
  constructor(entryKind: ExternalEntryKind, targetName: string | undefined, source: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to load ${describeEntry(entryKind, targetName, false)} from ${source}: ${reason}`,
      'EXTERNAL_ENTRY_LOAD_FAILED',
      entryKind,
      targetName,
      source,
    );
    this.cause = cause;
  }
}

/** The package or remote server of a `.esm()` / `.remote()` entry has no entry of that kind with the target name. */
export class ExternalEntryNotFoundError extends ExternalEntryError {
  constructor(entryKind: ExternalEntryKind, targetName: string, source: string, availableNames: readonly string[]) {
    const available = availableNames.length > 0 ? availableNames.join(', ') : 'none';
    super(
      `${describeEntry(entryKind, targetName)} was not found in ${source} (${entryKind}s there: ${available})`,
      'EXTERNAL_ENTRY_NOT_FOUND',
      entryKind,
      targetName,
      source,
    );
  }
}

/** A `.esm()` / `.remote()` entry used where it cannot be loaded, e.g. `Agent.esm()`. */
export class ExternalEntryNotSupportedError extends ExternalEntryError {
  constructor(entryKind: ExternalEntryKind, targetName: string | undefined, source: string, reason: string) {
    super(
      `${describeEntry(entryKind, targetName)} from ${source} is not supported: ${reason}`,
      'EXTERNAL_ENTRY_NOT_SUPPORTED',
      entryKind,
      targetName,
      source,
    );
  }
}
