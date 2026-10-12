import {
  buildCDNInfoForUIType,
  buildToolResponseContent,
  isUIRenderFailure,
  MCP_APPS_MIME_TYPE,
  renderToolTemplate,
  resolveServingMode,
  warnIfComponentReference,
} from '@frontmcp/uipack/adapters';
import { validateCSPDomain, type WidgetSizing } from '@frontmcp/uipack/shell';

import { type UIResourceMeta } from './ui-shared';

export {
  buildCDNInfoForUIType,
  buildToolResponseContent,
  isUIRenderFailure,
  MCP_APPS_MIME_TYPE,
  renderToolTemplate,
  resolveServingMode,
  warnIfComponentReference,
};

/**
 * Extract widget sizing config (`preferredHeight` / `minHeight` / `maxHeight` /
 * `aspectRatio` / `autoResize`) from a tool's `ui` config so it flows into the
 * rendered shell (CSS + `__mcpWidgetSizing`) and the response `_meta`.
 *
 * Returns `undefined` when no sizing field is set so widgets that don't opt in
 * stay byte-for-byte unchanged.
 */
export function extractSizing(uiConfig: Record<string, unknown> | undefined): WidgetSizing | undefined {
  if (!uiConfig) return undefined;
  const sizing: WidgetSizing = {};
  let has = false;
  if (uiConfig['preferredHeight'] !== undefined) {
    sizing.preferredHeight = uiConfig['preferredHeight'] as WidgetSizing['preferredHeight'];
    has = true;
  }
  if (uiConfig['minHeight'] !== undefined) {
    sizing.minHeight = uiConfig['minHeight'] as WidgetSizing['minHeight'];
    has = true;
  }
  if (uiConfig['maxHeight'] !== undefined) {
    sizing.maxHeight = uiConfig['maxHeight'] as WidgetSizing['maxHeight'];
    has = true;
  }
  if (uiConfig['aspectRatio'] !== undefined) {
    sizing.aspectRatio = uiConfig['aspectRatio'] as WidgetSizing['aspectRatio'];
    has = true;
  }
  if (uiConfig['autoResize'] !== undefined) {
    sizing.autoResize = uiConfig['autoResize'] as WidgetSizing['autoResize'];
    has = true;
  }
  return has ? sizing : undefined;
}

/**
 * A tool's `ui.csp` with only the origins the widget page's own Content-Security-Policy can
 * list. Startup already warned about the others (see `describeIgnoredUiOptions`), so leaving
 * them out here keeps a render from warning again on every call.
 */
export function pageCsp(uiConfig: Record<string, unknown> | undefined): UIResourceMeta['csp'] | undefined {
  const csp = uiConfig?.['csp'] as UIResourceMeta['csp'] | undefined;
  if (!csp) return undefined;
  const listable = (domains: unknown): string[] | undefined =>
    Array.isArray(domains)
      ? domains.filter((domain): domain is string => typeof domain === 'string' && validateCSPDomain(domain))
      : undefined;
  return { connectDomains: listable(csp.connectDomains), resourceDomains: listable(csp.resourceDomains) };
}

export function getUIResourceMimeType(_platformOrUri?: string): string {
  if (_platformOrUri?.endsWith('.js')) return 'application/javascript';
  if (_platformOrUri?.endsWith('.css')) return 'text/css';
  return MCP_APPS_MIME_TYPE;
}
