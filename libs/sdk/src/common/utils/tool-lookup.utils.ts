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

/** The other names a tool answers to (`@Tool({ aliases })`). */
export function toolAliasesOf(tool: Pick<ToolEntry, 'metadata'>): readonly string[] {
  return tool.metadata.aliases ?? [];
}

/**
 * Finds a tool by one of its aliases, then by name, in the scope, then in remote apps whose tools have not reached
 * the scope yet. A name that finds nothing is read as `owner.name`, the full name `owner:name`, so `tools/call` and
 * `this.callTool()` reach the same tools. An alias wins over that reading: `review.list` reaches the tool that
 * declares it, not `review:list`.
 */
export function lookupTool(scope: ToolLookupScope, name: string): ToolEntry | undefined {
  const fullName = ownerQualifiedName(name);
  const scopeTools = scope.tools.getTools(true);
  return (
    findTool(scope, scopeTools, (entry) => toolAliasesOf(entry).includes(name)) ??
    findTool(scope, scopeTools, matchesName(name)) ??
    (fullName === undefined ? undefined : findTool(scope, scopeTools, matchesName(fullName)))
  );
}

/** `owner.name` read as the full name `owner:name`, or `undefined` for a name without an owner part. */
export function ownerQualifiedName(name: string): string | undefined {
  const separator = name.indexOf('.');
  return separator > 0 ? `${name.slice(0, separator)}:${name.slice(separator + 1)}` : undefined;
}

/** A tool, or the names of one about to be built, as alias conflicts are read from it. */
export type ToolAliasCandidate = Pick<ToolEntry, 'name' | 'fullName' | 'metadata'>;

/**
 * One line per alias that is also the name of a tool in `tools` or the alias of another one, which would make a call
 * by that name reach a tool its caller did not mean.
 */
export function describeToolAliasConflicts(tools: readonly ToolAliasCandidate[]): string[] {
  const uniqueTools = [...new Set(tools)];
  const toolByName = new Map<string, ToolAliasCandidate>();
  for (const tool of uniqueTools) {
    toolByName.set(tool.name, tool);
    toolByName.set(tool.fullName, tool);
  }
  const toolByAlias = new Map<string, ToolAliasCandidate>();
  const conflicts: string[] = [];
  for (const tool of uniqueTools) {
    for (const alias of toolAliasesOf(tool)) {
      const named = toolByName.get(alias);
      if (named) conflicts.push(`alias "${alias}" of tool "${tool.name}" is the name of tool "${named.name}"`);
      const declarer = toolByAlias.get(alias);
      if (declarer && declarer !== tool) {
        conflicts.push(`alias "${alias}" is declared by both "${declarer.fullName}" and "${tool.fullName}"`);
      }
      toolByAlias.set(alias, tool);
    }
  }
  return conflicts;
}

function matchesName(name: string): (entry: ToolEntry) => boolean {
  const candidateNames = toolNameCandidates(name);
  return (entry) => candidateNames.includes(entry.fullName) || candidateNames.includes(entry.name);
}

function findTool(
  scope: ToolLookupScope,
  scopeTools: readonly ToolEntry[],
  matches: (entry: ToolEntry) => boolean,
): ToolEntry | undefined {
  const scopeTool = scopeTools.find(matches);
  if (scopeTool) return scopeTool;

  for (const appRegistry of scope.providers?.getRegistries('AppRegistry') ?? []) {
    for (const app of appRegistry.getApps()) {
      if (!app.isRemote) continue;
      const remoteTool = app.tools.getTools(true).find(matches);
      if (remoteTool) return remoteTool;
    }
  }
  return undefined;
}
