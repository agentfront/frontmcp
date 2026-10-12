import { ToolKind, type ScopeEntry, type ToolExternalRecord, type ToolRecord } from '../common';

/** The tools a `.esm()` / `.remote()` record or a package specifier string names, loaded from their source. */
export async function loadExternalToolRecords(scope: ScopeEntry, record: ToolExternalRecord): Promise<ToolRecord[]> {
  if (record.kind === ToolKind.ESM) {
    const { loadEsmToolEntries } = await import('../esm-loader/esm-entries.js');
    return loadEsmToolEntries(scope, record);
  }
  const { loadRemoteToolEntry } = await import('../remote-mcp/remote-entries.js');
  return [await loadRemoteToolEntry(scope, record)];
}
