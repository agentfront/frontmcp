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

import type { CodeCallMode, CodeCallToolMetadata, DirectCallsFilterFn, IncludeToolsFilterFn } from '../codecall.types';

/** Namespaces CodeCall never calls, whatever the configuration says. */
const BLOCKED_NAMESPACE_PATTERNS: readonly RegExp[] = Object.freeze([/^system:/, /^internal:/, /^__/]);

/** The subset of a ToolEntry this decision needs, so callers need not pass the whole entry. */
export interface CodeCallPolicyTool {
  name: string;
  appId?: string;
  description?: string;
  tags?: string[];
  hideFromDiscovery?: boolean;
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

const ALLOWED: CodeCallPolicyDecision = { allowed: true };

function deny(reason: string): CodeCallPolicyDecision {
  return { allowed: false, reason };
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

  if (name.startsWith('codecall:')) {
    return deny('CodeCall meta-tools are not callable from CodeCall');
  }

  if (BLOCKED_NAMESPACE_PATTERNS.some((pattern) => pattern.test(name))) {
    return deny(`Tool "${name}" is in a namespace CodeCall never calls`);
  }

  if (tool.hideFromDiscovery === true) {
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

  if (config.includeTools) {
    const included = config.includeTools({
      name,
      appId: tool.appId,
      source: tool.codecall?.source,
      description: tool.description,
      tags: tool.codecall?.tags ?? tool.tags,
    });
    if (!included) {
      return deny(`Tool "${name}" is excluded by the includeTools filter`);
    }
  }

  return ALLOWED;
}

/**
 * A tool the policy cannot evaluate is denied.
 *
 * `callTool` receives a bare string, so a name matching no resolvable tool would otherwise
 * skip every metadata-driven check above and fall straight through to `tools:call-tool`.
 */
export function denyUnknownTool(name: string): CodeCallPolicyDecision {
  return deny(`Tool "${name}" is not available through CodeCall`);
}

interface ResolvableEntry {
  name: string;
  fullName: string;
}

interface ToolResolutionScope {
  tools: { getTools(includeHidden: boolean): ResolvableEntry[] };
  providers: {
    getRegistries(
      kind: string,
    ): Array<{
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

  if (directCalls.allowedTools && !directCalls.allowedTools.includes(tool.name)) {
    return deny(`Tool "${tool.name}" is not in the direct-call allowlist`);
  }

  if (directCalls.filter) {
    const permitted = directCalls.filter({
      name: tool.name,
      appId: tool.appId,
      source: tool.codecall?.source,
      tags: tool.codecall?.tags ?? tool.tags,
    });
    if (!permitted) {
      return deny(`Tool "${tool.name}" is excluded by the directCalls filter`);
    }
  }

  return ALLOWED;
}

interface PolicyConfigReader {
  get(key: string): unknown;
}

/**
 * Resolve a tool name and decide whether CodeCall may reach it.
 *
 * The one entry point for both meta-tools: `codecall:execute` calls it for every `callTool`
 * and `getTool`, `codecall:invoke` for its single target with `directCall: true`. Sharing it
 * is the point — the advisory existed because execution and discovery each had their own
 * answer.
 */
export function checkCodeCallToolAccess(
  scope: unknown,
  config: PolicyConfigReader,
  name: string,
  options: { directCall?: boolean } = {},
): CodeCallPolicyDecision {
  const entry = resolveCodeCallTool<{ name: string; fullName: string; metadata?: unknown }>(scope, name);

  if (!entry) return denyUnknownTool(name);

  const metadata = entry.metadata as
    | { description?: string; tags?: string[]; hideFromDiscovery?: boolean; codecall?: CodeCallToolMetadata }
    | undefined;
  const owner = (entry as { owner?: { kind?: string; id?: string } }).owner;

  const policyTool: CodeCallPolicyTool = {
    name: entry.name || entry.fullName,
    appId: owner?.kind === 'app' ? owner.id : undefined,
    description: metadata?.description,
    tags: metadata?.tags,
    hideFromDiscovery: metadata?.hideFromDiscovery,
    codecall: metadata?.codecall,
  };

  const baseDecision = checkCodeCallToolPolicy(policyTool, {
    // An absent mode means an unparsed/partial config, not a hostile one: fall back to the
    // schema's own documented default rather than denying every call. An unrecognised mode
    // still fails closed inside the policy's switch.
    mode: (config.get('mode') ?? 'codecall_only') as CodeCallMode,
    includeTools: config.get('includeTools') as IncludeToolsFilterFn | undefined,
  });
  if (!baseDecision.allowed) return baseDecision;

  if (!options.directCall) return ALLOWED;

  return checkDirectCallPolicy(policyTool, config.get('directCalls') as CodeCallDirectCallsConfig | undefined);
}
