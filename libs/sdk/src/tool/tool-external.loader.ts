import { ToolKind, type ScopeEntry, type ToolExternalRecord, type ToolRecord } from '../common';
import { loadEsmToolEntries } from '../esm-loader/esm-entries';
import { loadRemoteToolEntry } from '../remote-mcp/remote-entries';

/** The tools a `.esm()` / `.remote()` record or a package specifier string names, loaded from their source. */
export async function loadExternalToolRecords(scope: ScopeEntry, record: ToolExternalRecord): Promise<ToolRecord[]> {
  if (record.kind === ToolKind.ESM) return loadEsmToolEntries(scope, record);
  return [await loadRemoteToolEntry(scope, record)];
}
