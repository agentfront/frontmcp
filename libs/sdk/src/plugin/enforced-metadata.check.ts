import { getMetadata } from '@frontmcp/di';

import type AgentRegistry from '../agent/agent.registry';
import {
  FrontMcpPluginTokens,
  type AgentEntry,
  type FlowName,
  type HookEntry,
  type PluginType,
  type ResourceEntry,
  type ToolEntry,
} from '../common';
import {
  describeMetadataEnforcer,
  getEnforcedMetadataKeys,
  isEnforcementRequested,
} from '../common/utils/enforced-metadata.utils';
import type HookRegistry from '../hooks/hook.registry';
import { hookClassOf } from '../hooks/hook.registry';
import type PromptRegistry from '../prompt/prompt.registry';
import type ResourceRegistry from '../resource/resource.registry';
import type SkillRegistry from '../skill/skill.registry';
import type ToolRegistry from '../tool/tool.registry';
import { normalizeTool } from '../tool/tool.utils';
import { appOwnerIdOf, hookOwnerIdOf } from '../utils/lineage.utils';
import { normalizePlugin } from './plugin.utils';

/** The registries of one scope whose entries the check covers. */
export interface EnforcedMetadataScope {
  hooks: HookRegistry;
  tools: ToolRegistry;
  resources: ResourceRegistry;
  prompts: PromptRegistry;
  agents: AgentRegistry;
  skills: SkillRegistry;
}

/** Metadata keys a hook's plugin class declares with `@Plugin({ enforcesMetadata })`. */
function keysEnforcedBy(hook: HookEntry): readonly string[] {
  const cls = hookClassOf(hook);
  if (typeof cls !== 'function') return [];
  const keys: unknown = getMetadata(FrontMcpPluginTokens.enforcesMetadata, cls);
  return Array.isArray(keys) ? (keys as string[]) : [];
}

/** Keys the plugins in a plugin list declare, nested plugins included. */
function keysEnforcedByPlugins(plugins: readonly PluginType[] | undefined, into = new Set<string>()): Set<string> {
  for (const plugin of plugins ?? []) {
    const { metadata } = normalizePlugin(plugin);
    for (const key of metadata.enforcesMetadata ?? []) into.add(key);
    keysEnforcedByPlugins(metadata.plugins, into);
  }
  return into;
}

/**
 * The metadata of the tools an agent can call: its private scope's tools (declared and contributed by
 * its plugins) once the agent is initialized, else the tools it declares.
 */
export function agentToolMetadata(agent: AgentEntry): ToolEntry['metadata'][] {
  const tools = (agent as { getAgentTools?: () => readonly ToolEntry[] }).getAgentTools?.();
  if (tools && tools.length > 0) return tools.map((tool) => tool.metadata);
  return (agent.metadata.tools ?? []).map((toolType) => normalizeTool(toolType).metadata);
}

/** An entry's requested keys, with who enforces each, as startup-error lines. */
function problemsOf(label: string, metadata: unknown, isEnforced: (key: string) => boolean): string[] {
  const fields = (metadata ?? {}) as Record<string, unknown>;
  return getEnforcedMetadataKeys()
    .filter((key) => isEnforcementRequested(fields[key]) && !isEnforced(key))
    .map((key) => {
      const enforcer = describeMetadataEnforcer(key);
      return `${label} declares '${key}'${enforcer ? ` (enforced by ${enforcer})` : ''}`;
    });
}

/**
 * Entries that declare metadata only a plugin enforces (`approval`, `featureFlag`, ...) while no hook
 * of a plugin that enforces it reaches them, as one line per entry and key.
 *
 * Coverage is read from the scope's hook registry the way the flows read it at request time: for
 * each entry, the hooks of the flow that gates it (`tools/call` for tools and agents,
 * `resources/read` for resources and templates, `prompts/get` for prompts, `skills:filter` for
 * skills), for the entry's hook owner. So a server-level plugin covers every entry, an app's plugin
 * covers its app, and, with `appliesTo: 'uncovered-apps'`, the apps that have no instance of it.
 * Tools declared inside an `@Agent` run through the agent's own flow, so the agent's plugins cover
 * them, and with `execution.inheritPlugins` also those that cover the agent's app; none do with
 * `execution.useToolFlow: false`. Hidden entries are included.
 */
export function findUnenforcedMetadata(scope: EnforcedMetadataScope): string[] {
  const coveredBy = (flow: FlowName, ownerId: string | undefined) => {
    const hooks = scope.hooks.getFlowHooksForOwner(flow, ownerId);
    return (key: string) => hooks.some((hook) => keysEnforcedBy(hook).includes(key));
  };
  const toolOwnerId = (tool: ToolEntry) => hookOwnerIdOf(scope.tools.lineageOf(tool) ?? [], tool.owner);

  const problems: string[] = [];
  const agentTools = new Set<ToolEntry>();

  for (const agent of scope.agents.getAgents(true)) {
    // `invoke_<agent>`, which the agent's `approval`, `featureFlag`... are copied onto (AgentInstance).
    const tool = (agent as { getToolInstance?: () => ToolEntry | null }).getToolInstance?.();
    if (tool) agentTools.add(tool);
    const ownerId = tool ? toolOwnerId(tool) : hookOwnerIdOf([], agent.owner);
    problems.push(...problemsOf(`Agent "${agent.name}"`, agent.metadata, coveredBy('tools:call-tool', ownerId)));

    // The agent's own tools are called through the agent's private scope, which has its plugins, and
    // with `execution.inheritPlugins` the hooks the server runs for the agent's owner (AgentScope).
    // They include the tools its plugins contribute, so read the tools that scope holds.
    const agentPlugins = keysEnforcedByPlugins(agent.metadata.plugins);
    const inheritedPlugins =
      agent.metadata.execution?.inheritPlugins === true ? coveredBy('tools:call-tool', agent.owner.id) : () => false;
    const usesToolFlow = agent.metadata.execution?.useToolFlow !== false;
    for (const metadata of agentToolMetadata(agent)) {
      problems.push(
        ...problemsOf(
          `Tool "${agent.name}:${metadata.name}"`,
          metadata,
          (key) => usesToolFlow && (agentPlugins.has(key) || inheritedPlugins(key)),
        ),
      );
    }
  }

  for (const tool of scope.tools.getTools(true)) {
    if (agentTools.has(tool)) continue;
    problems.push(...problemsOf(`Tool "${tool.name}"`, tool.metadata, coveredBy('tools:call-tool', toolOwnerId(tool))));
  }
  const readResource = (resource: ResourceEntry) =>
    coveredBy('resources:read-resource', appOwnerIdOf(scope.resources.lineageOf(resource) ?? [], resource.owner));
  for (const resource of scope.resources.getResources(true)) {
    problems.push(...problemsOf(`Resource "${resource.name}"`, resource.metadata, readResource(resource)));
  }
  for (const template of scope.resources.getResourceTemplates()) {
    problems.push(...problemsOf(`Resource template "${template.name}"`, template.metadata, readResource(template)));
  }
  for (const prompt of scope.prompts.getPrompts(true)) {
    const ownerId = appOwnerIdOf(scope.prompts.lineageOf(prompt) ?? [], prompt.owner);
    problems.push(...problemsOf(`Prompt "${prompt.name}"`, prompt.metadata, coveredBy('prompts:get-prompt', ownerId)));
  }
  for (const skill of scope.skills.getSkills(true)) {
    problems.push(...problemsOf(`Skill "${skill.name}"`, skill.metadata, coveredBy('skills:filter', undefined)));
  }
  return problems;
}
