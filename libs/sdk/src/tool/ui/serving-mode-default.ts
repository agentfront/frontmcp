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

/** The serving modes whose page is built once, at startup or elsewhere, rather than for each call. */
export const BUILT_ONCE_SERVING_MODES: readonly WidgetServingMode[] = ['static', 'hybrid', 'direct-url', 'custom-url'];

/**
 * A serving mode narrowed by a tool's `ui.bundlingMode`: `'dynamic'` renders the page for each call
 * (`'inline'`), and `'static'` keeps a mode that builds it once or else compiles it at startup
 * (`'static'`). Unset, the mode stands.
 */
function withBundlingMode(mode: WidgetServingMode, bundlingMode: unknown): WidgetServingMode {
  if (bundlingMode === 'dynamic') return 'inline';
  if (bundlingMode === 'static') return BUILT_ONCE_SERVING_MODES.includes(mode) ? mode : 'static';
  return mode;
}

/**
 * The serving mode `tool`'s widget uses (#720): its own `ui.servingMode`, else its app's
 * `@App({ ui: { servingMode } })`, else the server's `@FrontMcp({ ui: { servingMode } })`, else
 * `'auto'`. The tool's own `ui.bundlingMode` then picks between rendering per call and building
 * once where that mode leaves it open (`'auto'`, or an inherited default). `tools/call` (the
 * `applyUI` stage) and the widget pre-compilation at startup both read it, so a tool is rendered
 * and served by the same mode.
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
  // A tool's own mode that disagrees with its bundlingMode is refused at startup
  if (own !== undefined && own !== 'auto') return own;
  const bundlingMode = tool.metadata.ui?.bundlingMode;
  if (own === 'auto') return withBundlingMode(own, bundlingMode);
  const appId = appOwnerIdOf(scope.tools.lineageOf(tool) ?? [], tool.owner);
  const app = appId === undefined ? undefined : scope.apps.getApps().find((candidate) => candidate.id === appId);
  // Remote apps have no `ui` option
  const appMode = (app?.metadata as { ui?: { servingMode?: WidgetServingMode } } | undefined)?.ui?.servingMode;
  return withBundlingMode(resolveWidgetServingMode(undefined, appMode, scope.metadata.ui?.servingMode), bundlingMode);
}
