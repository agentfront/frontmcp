// file: libs/sdk/src/hooks/hook-coverage.ts

import type { FlowName, PromptEntry, ResourceEntry, ScopeEntry, SkillEntry, ToolEntry } from '../common';
import { appOwnerIdOf, hookOwnerIdOf } from '../utils/lineage.utils';

/**
 * A tool, whatever its schemas and input/output types, as the tool registry and the list flows
 * hold them (their state types a listed tool's input and output as `unknown`).
 */

type AnyToolEntry = ToolEntry<any, any, any, any>;

/** An entry of a scope, by the kind of flow that serves it by name or URI. */
export type HookGatedEntry =
  | { readonly tool: AnyToolEntry }
  | { readonly resource: ResourceEntry }
  | { readonly prompt: PromptEntry }
  | { readonly skill: SkillEntry };

/**
 * The flow that serves an entry by name or URI, and the hook owner it resolves for the entry: the
 * one `CallToolFlow`, `ReadResourceFlow` and `GetPromptFlow` resolve (completion follows the prompt
 * or resource it completes for). Skills are served through `skills:filter`, owned by their app.
 */
function gateOf(scope: ScopeEntry, entry: HookGatedEntry): { flow: FlowName; ownerId: string | undefined } {
  if ('tool' in entry) {
    return {
      flow: 'tools:call-tool',
      ownerId: hookOwnerIdOf(scope.tools.lineageOf(entry.tool) ?? [], entry.tool.owner),
    };
  }
  if ('resource' in entry) {
    return {
      flow: 'resources:read-resource',
      ownerId: appOwnerIdOf(scope.resources.lineageOf(entry.resource) ?? [], entry.resource.owner),
    };
  }
  if ('prompt' in entry) {
    return {
      flow: 'prompts:get-prompt',
      ownerId: appOwnerIdOf(scope.prompts.lineageOf(entry.prompt) ?? [], entry.prompt.owner),
    };
  }
  return { flow: 'skills:filter', ownerId: appOwnerIdOf([], entry.skill.owner) };
}

/**
 * Whether the hooks `target` (a plugin instance) registered run when the scope serves `entry` by
 * name or URI: in `tools/call` for a tool, `resources/read` for a resource or resource template,
 * `prompts/get` for a prompt, and `skills:filter` for a skill. The hooks are selected as those
 * flows select them, for the entry's app, so a hook's `appliesTo` counts.
 *
 * List flows run every app plugin's hooks over every app's entries. A list hook that hides what
 * its own plugin's gate refuses judges only the entries that gate judges, so each entry is listed
 * and served on the answer of the same plugin instance.
 */
export function isEntryGatedBy(scope: ScopeEntry, entry: HookGatedEntry, target: object): boolean {
  const { flow, ownerId } = gateOf(scope, entry);
  return scope.hooks.getFlowHooksForOwner(flow, ownerId).some((hook) => hook.metadata.target === target);
}
