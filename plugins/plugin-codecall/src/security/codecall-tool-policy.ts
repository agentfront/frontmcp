// file: plugins/plugin-codecall/src/security/codecall-tool-policy.ts
//
// The single decision for "may CodeCall touch this tool", shared by discovery and
// execution.
//
// GHSA-6w3j-82v5-6qrr: this policy used to live only inside
// `ToolSearchService.shouldIndexTool` — a private method named for *indexing*. Discovery
// honoured `enabledInCodeCall`, `includeTools` and the blocked namespaces; the execution
// path honoured none of them, so an excluded tool stayed callable by name. Keeping the
// decision here, with both callers delegating to it, is what stops the two drifting apart
// again.
//
// The two callers must also build the same subject. Execution once judged `fullName`
// (`crm:admin:deleteUser`) while search judged `name` (`admin:deleteUser`), so a name-based
// `includeTools` filter hid a tool from search and let `callTool` run it. Both now go through
// `toCodeCallPolicyTool`, and `includeTools` receives one object from `toToolFilterInfo`.

import type {
  CodeCallMode,
  CodeCallToolMetadata,
  DirectCallsFilterFn,
  IncludeToolsFilterFn,
  IncludeToolsFilterToolInfo,
} from '../codecall.types';

/** Namespaces CodeCall never calls, whatever the configuration says. */
const BLOCKED_NAMESPACE_PATTERNS: readonly RegExp[] = Object.freeze([/^system:/, /^internal:/, /^__/]);

/** An owner in a registry entry's lineage: an app, adapter, plugin or the scope. */
interface CodeCallPolicyOwner {
  kind?: string;
  id?: string;
}

/** A registry entry as the policy reads it: a `ToolEntry`, or anything shaped like one. */
export interface CodeCallPolicyEntry {
  name: string;
  fullName: string;
  owner?: CodeCallPolicyOwner;
  metadata?: {
    description?: string;
    tags?: string[];
    hideFromDiscovery?: boolean;
    visibility?: string;
    codecall?: CodeCallToolMetadata;
  };
}

/** The policy's view of one tool. Build it with `toCodeCallPolicyTool`. */
export interface CodeCallPolicyTool {
  /** The tool's own name: the `name` search indexes and `includeTools` receives. */
  name: string;
  /** The qualified `<owner>:<name>` spelling, which the flow dispatches as well. */
  fullName?: string;
  /**
   * Further spellings, such as the name the caller asked for.
   *
   * The namespace rules deny under every spelling, because judging one lets another through.
   * No allow decision ever reads an alias.
   */
  aliases?: string[];
  appId?: string;
  description?: string;
  tags?: string[];
  hidden?: boolean;
  codecall?: CodeCallToolMetadata;
}

export interface CodeCallPolicyConfig {
  mode: CodeCallMode;
  includeTools?: IncludeToolsFilterFn;
}

/** The `directCalls` options, which narrow `codecall:invoke` beyond the base policy. */
export interface CodeCallDirectCallsConfig {
  enabled: boolean;
  allowedTools?: string[];
  filter?: DirectCallsFilterFn;
}

export type CodeCallPolicyDecision = { allowed: true } | { allowed: false; reason: string };

/** A decision that also carries the entry it was made for, so callers use that exact entry. */
export type CodeCallToolAccess<T> = { allowed: true; entry: T } | { allowed: false; reason: string };

const ALLOWED: CodeCallPolicyDecision = { allowed: true };

function deny(reason: string): { allowed: false; reason: string } {
  return { allowed: false, reason };
}

interface ToolLineageScope {
  tools?: { lineageOf?(entry: unknown): readonly CodeCallPolicyOwner[] | undefined };
}

/**
 * The app a tool belongs to, found anywhere in its lineage in the scope's tool registry.
 *
 * A tool an app's adapter or plugin provides is owned by that adapter or plugin, so reading only
 * `owner` gave it no app, and an `includeTools: (t) => t.appId !== 'admin'` filter let it through.
 */
export function codeCallAppIdOf(scope: unknown, entry: CodeCallPolicyEntry): string | undefined {
  const lineage = (scope as ToolLineageScope | undefined)?.tools?.lineageOf?.(entry) ?? [];
  const owners = entry.owner ? [...lineage, entry.owner] : lineage;
  return owners.find((owner) => owner.kind === 'app')?.id;
}

/**
 * Build the policy subject for a registry entry.
 *
 * Search indexing, `describe` and execution all build their subject here, so none of them can
 * judge a different name than the others. Pass the scope so `appId` names the app of a tool its
 * adapters or plugins provide.
 */
export function toCodeCallPolicyTool(
  entry: CodeCallPolicyEntry,
  requestedName?: string,
  scope?: unknown,
): CodeCallPolicyTool {
  const { metadata } = entry;
  return {
    name: entry.name || entry.fullName,
    fullName: entry.fullName,
    aliases: requestedName ? [requestedName] : undefined,
    appId: codeCallAppIdOf(scope, entry),
    description: metadata?.description,
    tags: metadata?.tags,
    // `internal` tools refuse every external tools/call, CodeCall's included, so no surface may offer them.
    hidden:
      metadata?.hideFromDiscovery === true || metadata?.visibility === 'hidden' || metadata?.visibility === 'internal',
    codecall: metadata?.codecall,
  };
}

/** The object `includeTools` and `directCalls.filter` receive, wherever the policy runs. */
export function toToolFilterInfo(tool: CodeCallPolicyTool): IncludeToolsFilterToolInfo {
  return {
    name: tool.name,
    appId: tool.appId,
    source: tool.codecall?.source,
    description: tool.description,
    tags: tool.codecall?.tags ?? tool.tags,
  };
}

function ownNamesOf(tool: CodeCallPolicyTool): string[] {
  return [tool.name, tool.fullName].filter((candidate): candidate is string => !!candidate);
}

/**
 * Decide whether CodeCall may reach `tool`.
 *
 * Discovery and execution both call this. A tool the policy denies must be absent from
 * search results AND rejected at `callTool` — hiding it from search is not authorization.
 */
export function checkCodeCallToolPolicy(
  tool: CodeCallPolicyTool,
  config: CodeCallPolicyConfig,
): CodeCallPolicyDecision {
  const { name } = tool;
  const spellings = [...ownNamesOf(tool), ...(tool.aliases ?? [])];

  if (spellings.some((candidate) => candidate.startsWith('codecall:'))) {
    return deny('CodeCall meta-tools are not callable from CodeCall');
  }

  for (const candidate of spellings) {
    if (BLOCKED_NAMESPACE_PATTERNS.some((pattern) => pattern.test(candidate))) {
      return deny(`Tool "${candidate}" is in a namespace CodeCall never calls`);
    }
  }

  if (tool.hidden === true) {
    return deny(`Tool "${name}" is hidden from discovery`);
  }

  const enabled = tool.codecall?.enabledInCodeCall;

  switch (config.mode) {
    case 'codecall_only':
    case 'metadata_driven':
      if (enabled === false) {
        return deny(`Tool "${name}" sets enabledInCodeCall: false`);
      }
      break;

    case 'codecall_opt_in':
      if (enabled !== true) {
        return deny(`Tool "${name}" has not opted in to CodeCall`);
      }
      break;

    default:
      // An unrecognised mode must fail closed, not fall through to allowed.
      return deny(`Unknown CodeCall mode: ${String(config.mode)}`);
  }

  if (config.includeTools && !config.includeTools(toToolFilterInfo(tool))) {
    return deny(`Tool "${name}" is excluded by the includeTools filter`);
  }

  return ALLOWED;
}

/**
 * A tool the policy cannot evaluate is denied.
 *
 * `callTool` receives a bare string, so a name matching no resolvable tool would otherwise
 * skip every metadata-driven check above and fall straight through to `tools:call-tool`.
 */
export function denyUnknownTool(name: string): { allowed: false; reason: string } {
  return deny(`Tool "${name}" is not available through CodeCall`);
}

interface ResolvableEntry {
  name: string;
  fullName: string;
}

interface ToolResolutionScope {
  tools: { getTools(includeHidden: boolean): ResolvableEntry[] };
  providers: {
    getRegistries(kind: string): Array<{
      getApps(): Array<{ isRemote?: boolean; tools: { getTools(includeHidden: boolean): ResolvableEntry[] } }>;
    }>;
  };
}

/**
 * Resolve a tool name exactly as `call-tool.flow.ts` `findTool` does.
 *
 * MUST mirror that stage. The policy has to evaluate the same entry the flow will execute:
 * resolve more narrowly and legitimate remote-app tools get denied; resolve more loosely and
 * a tool reachable only through the flow's fallback escapes the policy entirely. The flow
 * applies three steps, and so does this —
 *   1. the scope registry,
 *   2. a hyphen <-> underscore alias (issue #408),
 *   3. remote app registries, for tools whose subscription has not yet propagated.
 */
export function resolveCodeCallTool<T extends ResolvableEntry>(scope: unknown, name: string): T | undefined {
  const typedScope = scope as ToolResolutionScope;

  const alias = /[-_]/.test(name)
    ? name.includes('_')
      ? name.replace(/_/g, '-')
      : name.replace(/-/g, '_')
    : undefined;
  const candidates = alias ? [name, alias] : [name];
  const matches = (entry: ResolvableEntry) => candidates.includes(entry.fullName) || candidates.includes(entry.name);

  const local = typedScope.tools?.getTools(true)?.find(matches);
  if (local) return local as T;

  const registries = typedScope.providers?.getRegistries?.('AppRegistry') ?? [];
  for (const registry of registries) {
    for (const app of registry.getApps()) {
      if (!app.isRemote) continue;
      const remote = app.tools.getTools(true).find(matches);
      if (remote) return remote as T;
    }
  }

  return undefined;
}

/**
 * Apply the `directCalls` options to a `codecall:invoke` request.
 *
 * These options were declared in the plugin schema and read by nothing, so `codecall:invoke`
 * proxied the entire registry regardless of how an operator configured it. They narrow the
 * base policy; they never widen it.
 */
export function checkDirectCallPolicy(
  tool: CodeCallPolicyTool,
  directCalls: CodeCallDirectCallsConfig | undefined,
): CodeCallPolicyDecision {
  // Leaving `directCalls` unset keeps direct invocation available, as it has always been.
  if (!directCalls) return ALLOWED;

  if (directCalls.enabled === false) {
    return deny('Direct tool invocation is disabled');
  }

  // A bare name or a qualified one both list the tool; the caller's own spelling never does.
  const { allowedTools } = directCalls;
  if (allowedTools && !ownNamesOf(tool).some((ownName) => allowedTools.includes(ownName))) {
    return deny(`Tool "${tool.name}" is not in the direct-call allowlist`);
  }

  if (directCalls.filter && !directCalls.filter(toToolFilterInfo(tool))) {
    return deny(`Tool "${tool.name}" is excluded by the directCalls filter`);
  }

  return ALLOWED;
}

interface PolicyConfigReader {
  get(key: string): unknown;
}

/** Read the base policy options from the plugin config. */
export function readCodeCallPolicyConfig(config: PolicyConfigReader): CodeCallPolicyConfig {
  return {
    // An absent mode means an unparsed/partial config, not a hostile one: fall back to the
    // schema's own documented default rather than denying every call. An unrecognised mode
    // still fails closed inside the policy's switch.
    mode: (config.get('mode') ?? 'codecall_only') as CodeCallMode,
    includeTools: config.get('includeTools') as IncludeToolsFilterFn | undefined,
  };
}

/**
 * Resolve a tool name and decide whether CodeCall may reach it.
 *
 * The one entry point for the meta-tools: `codecall:execute` calls it for every `callTool`
 * and `getTool`, `codecall:describe` for every name it is asked about, and `codecall:invoke`
 * for its single target with `directCall: true`. Sharing it is the point — the advisory
 * existed because execution and discovery each had their own answer.
 *
 * An allow decision carries the resolved entry. Callers describe or run that entry rather than
 * looking the name up again, which could land on a different tool than the one judged.
 */
export function checkCodeCallToolAccess<T extends CodeCallPolicyEntry = CodeCallPolicyEntry>(
  scope: unknown,
  config: PolicyConfigReader,
  name: string,
  options: { directCall?: boolean } = {},
): CodeCallToolAccess<T> {
  const entry = resolveCodeCallTool<T>(scope, name);
  if (!entry) return denyUnknownTool(name);

  const policyTool = toCodeCallPolicyTool(entry, name, scope);

  const baseDecision = checkCodeCallToolPolicy(policyTool, readCodeCallPolicyConfig(config));
  if (!baseDecision.allowed) return baseDecision;

  if (options.directCall) {
    const directDecision = checkDirectCallPolicy(
      policyTool,
      config.get('directCalls') as CodeCallDirectCallsConfig | undefined,
    );
    if (!directDecision.allowed) return directDecision;
  }

  return { allowed: true, entry };
}
