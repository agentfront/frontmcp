// file: libs/sdk/src/tool/tool-output-policy.ts

import {
  resolveOutputSchemaMode,
  type EntryLineage,
  type OutputPolicy,
  type ScopeEntry,
  type ToolEntry,
} from '../common';
import { appOwnerIdOf } from '../utils/lineage.utils';

/** A tool's `output` policies, most specific first, for the `resolve*` cascades in `output-policy.ts`. */
export type ToolOutputPolicies = [tool?: OutputPolicy, app?: OutputPolicy, server?: OutputPolicy];

/** The parts of a tool the output-policy lookup reads. */
type OutputPolicyTool = Pick<ToolEntry, 'metadata' | 'owner'>;

/** What the output-policy lookup reads from a scope: its metadata, its apps and its tools' lineage. */
export interface OutputPolicyScope<Tool extends OutputPolicyTool = ToolEntry> {
  readonly metadata: { readonly output?: OutputPolicy };
  readonly apps: Pick<ScopeEntry['apps'], 'getApps'>;
  readonly tools: { lineageOf(entry: Tool): EntryLineage | undefined };
}

/**
 * The `output` policies that apply to `tool`: its own, its app's and the server's. The app is the
 * one the tool is in, so a tool a plugin or an adapter of that app contributes follows it too.
 * `tools/list` and `tools/call` both read it, so a tool is listed and answered under one policy.
 */
export function toolOutputPolicies<Tool extends OutputPolicyTool>(
  tool: Tool,
  scope: OutputPolicyScope<Tool>,
): ToolOutputPolicies {
  const appId = appOwnerIdOf(scope.tools.lineageOf(tool) ?? [], tool.owner);
  const app = appId === undefined ? undefined : scope.apps.getApps().find((candidate) => candidate.id === appId);
  // Remote apps have no `output` option
  const appOutput = (app?.metadata as { output?: OutputPolicy } | undefined)?.output;
  return [tool.metadata.output, appOutput, scope.metadata.output];
}

/**
 * One startup warning for each listed tool whose declared `outputSchema` tools/list has to leave
 * out, naming the tool and the reason. A tool whose `output.schemaMode` resolves to `'none'` asked
 * for no schema, so it stays quiet.
 */
export function describeUnlistedOutputSchemas(
  scope: OutputPolicyScope & { readonly tools: { getTools(): ToolEntry[] } },
): string[] {
  return scope.tools.getTools().flatMap((tool) => {
    const reason = tool.getUnlistedOutputSchemaReason();
    if (!reason || resolveOutputSchemaMode(...toolOutputPolicies(tool, scope)) === 'none') return [];
    return [
      `Tool "${tool.metadata.name}": tools/list leaves out its outputSchema because ${reason}. ` +
        'Declare a z.object() or a union of z.object() schemas to list it.',
    ];
  });
}
