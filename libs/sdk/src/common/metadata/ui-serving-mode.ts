// file: libs/sdk/src/common/metadata/ui-serving-mode.ts
import { z } from '@frontmcp/lazy-zod';
import type { WidgetServingMode } from '@frontmcp/uipack/types';

/**
 * Every value a tool's `ui.servingMode` takes. The server-wide default
 * (`@FrontMcp({ ui: { servingMode } })`) and the app default (`@App({ ui: { servingMode } })`) accept
 * the same values (#720).
 */
export const WIDGET_SERVING_MODES = [
  'auto',
  'inline',
  'static',
  'hybrid',
  'direct-url',
  'custom-url',
] as const satisfies readonly WidgetServingMode[];

/** Validates a server or app `ui.servingMode` default. */
export const widgetServingModeSchema = z.enum(WIDGET_SERVING_MODES);

/** The serving mode used when neither the tool, its app nor the server sets one. */
export const DEFAULT_WIDGET_SERVING_MODE: WidgetServingMode = 'auto';

/**
 * The serving mode a tool's widget uses: the tool's own `ui.servingMode`, else its app's
 * `@App({ ui: { servingMode } })`, else the server's `@FrontMcp({ ui: { servingMode } })`, else
 * `'auto'`. The tool's own setting always wins.
 *
 * @param toolMode - The tool's `ui.servingMode` (unvalidated: a tool's `ui` is a loose object)
 * @param appMode - Its app's default
 * @param serverMode - The server's default
 * @returns The mode to serve the widget with
 */
export function resolveWidgetServingMode(
  toolMode: WidgetServingMode | undefined,
  appMode?: WidgetServingMode,
  serverMode?: WidgetServingMode,
): WidgetServingMode {
  return toolMode ?? appMode ?? serverMode ?? DEFAULT_WIDGET_SERVING_MODE;
}
