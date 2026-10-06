import type { ScopeEntry } from '../entries/scope.entry';
import type { ToolEntry } from '../entries/tool.entry';

/** Where a tool is looked up: the scope's tools, then the remote apps its providers hold (when it has them). */
export type ToolLookupScope = Pick<ScopeEntry, 'tools'> & Partial<Pick<ScopeEntry, 'providers'>>;

/**
 * Hyphen ↔ underscore name fallback (issue #408). Job-management tools were renamed from
 * `execute-job` to `execute_job`, so a caller using the old spelling still finds the tool.
 * The alias only applies after the exact name misses, so it never masks a real typo.
 */
export function toolNameCandidates(name: string): string[] {
  if (!/[-_]/.test(name)) return [name];
  return [name, name.includes('_') ? name.replace(/_/g, '-') : name.replace(/-/g, '_')];
}

/** Finds a tool by name or alias in the scope, then in remote apps whose tools have not reached the scope yet. */
export function lookupTool(scope: ToolLookupScope, name: string): ToolEntry | undefined {
  const candidateNames = toolNameCandidates(name);
  const matchesCandidate = (entry: { fullName: string; name: string }) =>
    candidateNames.includes(entry.fullName) || candidateNames.includes(entry.name);

  const scopeTool = scope.tools.getTools(true).find(matchesCandidate);
  if (scopeTool) return scopeTool;

  for (const appRegistry of scope.providers?.getRegistries('AppRegistry') ?? []) {
    for (const app of appRegistry.getApps()) {
      if (!app.isRemote) continue;
      const remoteTool = app.tools.getTools(true).find(matchesCandidate);
      if (remoteTool) return remoteTool;
    }
  }
  return undefined;
}

/**
 * The name a call of `name` resolves by: `name` itself when {@link lookupTool} finds a tool by it, else
 * `owner.name` read as the full name `owner:name` when that finds one, else `name` (the flow reports it).
 */
export function callableToolName(scope: Partial<ToolLookupScope>, name: string): string {
  const { tools, providers } = scope;
  if (!tools || lookupTool({ tools, providers }, name)) return name;
  const separator = name.indexOf('.');
  if (separator <= 0) return name;
  const fullName = `${name.slice(0, separator)}:${name.slice(separator + 1)}`;
  return lookupTool({ tools, providers }, fullName) ? fullName : name;
}
