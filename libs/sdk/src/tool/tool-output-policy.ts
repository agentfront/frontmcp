// file: libs/sdk/src/tool/tool-output-policy.ts

import {
  resolveOutputSchemaMode,
  type EntryLineage,
  type InputPolicy,
  type OutputPolicy,
  type ScopeEntry,
  type StructuredContentValidation,
  type ToolEntry,
} from '../common';
import { appOwnerIdOf } from '../utils/lineage.utils';

/** A tool's `output` policies, most specific first, for the `resolve*` cascades in `output-policy.ts`. */
export type ToolOutputPolicies = [tool?: OutputPolicy, app?: OutputPolicy, server?: OutputPolicy];

/** The parts of a tool the output-policy lookup reads. */
type OutputPolicyTool = Pick<ToolEntry, 'metadata' | 'owner'>;

/** What the output-policy lookup reads from a scope: its metadata, its apps and its tools' lineage. */
export interface OutputPolicyScope<Tool extends OutputPolicyTool = ToolEntry> {
  readonly metadata: { readonly output?: OutputPolicy; readonly input?: InputPolicy };
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
  // Remote apps have no `output` option
  const appOutput = (appMetadataOf(tool, scope) as { output?: OutputPolicy } | undefined)?.output;
  return [tool.metadata.output, appOutput, scope.metadata.output];
}

/** Resolve how a returned `CallToolResult`'s `structuredContent` is validated: Tool > App > server > 'warn'. */
export function resolveStructuredContentValidation(
  tool?: OutputPolicy,
  app?: OutputPolicy,
  server?: OutputPolicy,
): StructuredContentValidation {
  return (
    tool?.validateStructuredContent ?? app?.validateStructuredContent ?? server?.validateStructuredContent ?? 'warn'
  );
}

/** The `input` policies that apply to `tool`, most specific first: its own, its app's and the server's. */
export function toolInputPolicies<Tool extends OutputPolicyTool>(
  tool: Tool,
  scope: OutputPolicyScope<Tool>,
): [tool?: InputPolicy, app?: InputPolicy, server?: InputPolicy] {
  const appInput = (appMetadataOf(tool, scope) as { input?: InputPolicy } | undefined)?.input;
  return [tool.metadata.input, appInput, scope.metadata.input];
}

/** The metadata of the app `tool` is in, the app of a plugin or an adapter that contributed it included. */
function appMetadataOf<Tool extends OutputPolicyTool>(tool: Tool, scope: OutputPolicyScope<Tool>): unknown {
  const appId = appOwnerIdOf(scope.tools.lineageOf(tool) ?? [], tool.owner);
  return appId === undefined ? undefined : scope.apps.getApps().find((candidate) => candidate.id === appId)?.metadata;
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
