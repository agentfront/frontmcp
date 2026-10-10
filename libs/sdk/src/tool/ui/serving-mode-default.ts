// file: libs/sdk/src/tool/ui/serving-mode-default.ts

import type { EntryLineage, ScopeEntry, ToolEntry, WidgetServingMode } from '../../common';
import { resolveWidgetServingMode } from '../../common/metadata/ui-serving-mode';
import { appOwnerIdOf } from '../../utils/lineage.utils';

/** The parts of a tool the serving-mode lookup reads. */
type ServingModeTool = Pick<ToolEntry, 'metadata' | 'owner'>;

/** What the serving-mode lookup reads from a scope: its metadata, its apps and its tools' lineage. */
export interface ServingModeScope<Tool extends ServingModeTool = ToolEntry> {
  readonly metadata: Pick<ScopeEntry['metadata'], 'ui'>;
  readonly apps: Pick<ScopeEntry['apps'], 'getApps'>;
  readonly tools: { lineageOf(entry: Tool): EntryLineage | undefined };
}

/**
 * The serving mode `tool`'s widget uses (#720): its own `ui.servingMode`, else its app's
 * `@App({ ui: { servingMode } })`, else the server's `@FrontMcp({ ui: { servingMode } })`, else
 * `'auto'`. `tools/call` (the `applyUI` stage) and the widget pre-compilation at startup both read
 * it, so a tool is rendered and served by the same mode.
 *
 * @param tool - A tool with a `ui` config
 * @param scope - The scope serving it
 * @returns The configured serving mode, before platform resolution
 */
export function toolServingMode<Tool extends ServingModeTool>(
  tool: Tool,
  scope: ServingModeScope<Tool>,
): WidgetServingMode {
  const own = tool.metadata.ui?.servingMode;
  if (own !== undefined) return own;
  const appId = appOwnerIdOf(scope.tools.lineageOf(tool) ?? [], tool.owner);
  const app = appId === undefined ? undefined : scope.apps.getApps().find((candidate) => candidate.id === appId);
  // Remote apps have no `ui` option
  const appMode = (app?.metadata as { ui?: { servingMode?: WidgetServingMode } } | undefined)?.ui?.servingMode;
  return resolveWidgetServingMode(undefined, appMode, scope.metadata.ui?.servingMode);
}
