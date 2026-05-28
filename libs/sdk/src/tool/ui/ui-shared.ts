/**
 * Shared UI utilities and types
 *
 * Internal module to avoid circular imports between index.ts and ui-resource.handler.ts.
 */

import { MCP_APPS_MIME_TYPE, renderToolTemplate, detectUIType as uipackDetectUIType } from '@frontmcp/uipack/adapters';
import { type ImportResolver } from '@frontmcp/uipack/resolver';

// ============================================
// ToolUIRegistry
// ============================================

/** Per-tool resource metadata attached to `ui://widget/{tool}.html` content reads. */
export interface UIResourceMeta {
  /**
   * CSP directives the host should apply to the widget iframe. Emitted on
   * the resource content item's `_meta` so MCP Apps hosts (Claude) actually
   * honor it — `_meta.ui.csp` on the tool is ignored (#455).
   */
  csp?: { connectDomains?: string[]; resourceDomains?: string[] };
  /**
   * MCP Apps permissions (future-compatibility slot — currently sourced from
   * `uiConfig.permissions` if present so it round-trips to the resource).
   */
  permissions?: unknown;
}

/** Tool UI Registry — manages compiled widgets and rendering. */
export class ToolUIRegistry {
  private widgets = new Map<string, string>();
  private manifests = new Map<string, Record<string, unknown>>();
  private resourceMeta = new Map<string, UIResourceMeta>();
  private resolver?: ImportResolver;

  constructor(resolver?: ImportResolver) {
    this.resolver = resolver;
  }

  getStaticWidget(name: string): string | undefined {
    return this.widgets.get(name);
  }

  hasAny(): boolean {
    return this.widgets.size > 0;
  }

  getManifest(toolName: string): Record<string, unknown> | undefined {
    return this.manifests.get(toolName);
  }

  /**
   * Per-tool resource metadata for the `ui://widget/{tool}.html` content read.
   * Returns `undefined` when nothing was configured — the handler should
   * omit `_meta` entirely in that case so MCP clients don't see an empty
   * object.
   */
  getResourceMeta(toolName: string): UIResourceMeta | undefined {
    return this.resourceMeta.get(toolName);
  }

  detectUIType(template: unknown): string {
    return uipackDetectUIType(template);
  }

  async compileStaticWidgetAsync(options: Record<string, unknown>): Promise<void> {
    const toolName = options['toolName'] as string;
    const template = options['template'];
    const input = options['input'] ?? {};
    const output = options['output'] ?? {};
    const uiConfig = options['uiConfig'] as Record<string, unknown> | undefined;
    // Prefer ui.resourceMode (configured by the user); fall back to a top-level
    // override on options so tests / programmatic callers can pass it directly.
    const resourceMode = (uiConfig?.['resourceMode'] ?? options['resourceMode']) as 'cdn' | 'inline' | undefined;

    if (!toolName || !template) return;

    // Persist per-tool resource metadata (CSP / permissions) BEFORE render so
    // `handleUIResourceRead` returns the right `_meta.ui.csp` even if the
    // render fails (graceful degradation) and on re-compile when the user
    // removes a previously-set csp/permissions field (we explicitly delete in
    // that case so stale meta doesn't leak forward). Claude only honors CSP
    // declared on the resource, not on the tool — #455.
    this.updateResourceMetaFromConfig(toolName, uiConfig);

    const result = renderToolTemplate({
      toolName,
      input,
      output,
      template,
      resolver: this.resolver,
      resourceMode,
    });

    this.widgets.set(toolName, result.html);
    this.manifests.set(toolName, {
      uiType: result.uiType,
      hash: result.hash,
      size: result.size,
    });
  }

  /**
   * Sync `resourceMeta[toolName]` to the current `uiConfig`. Called before
   * every render so the entry stays consistent with the latest decorator
   * state, including the case where a user removes a previously-set
   * `ui.csp` / `ui.permissions` field on re-compile.
   */
  private updateResourceMetaFromConfig(toolName: string, uiConfig: Record<string, unknown> | undefined): void {
    const csp = uiConfig?.['csp'] as UIResourceMeta['csp'] | undefined;
    const permissions = uiConfig?.['permissions'] as UIResourceMeta['permissions'] | undefined;
    if (csp || permissions !== undefined) {
      this.resourceMeta.set(toolName, { csp, permissions });
    } else {
      this.resourceMeta.delete(toolName);
    }
  }

  async compileLeanWidgetAsync(options: Record<string, unknown>): Promise<void> {
    // Lean mode uses same logic as static for now
    await this.compileStaticWidgetAsync(options);
  }

  async compileHybridWidgetAsync(options: Record<string, unknown>): Promise<void> {
    // Hybrid compiles the shell but not data.
    // Template functions may fail at startup (no real data available),
    // so set a fallback manifest to ensure buildHybridComponentPayload works.
    try {
      await this.compileStaticWidgetAsync(options);
    } catch {
      const toolName = options['toolName'] as string;
      const template = options['template'];
      if (toolName && template) {
        const uiType = uipackDetectUIType(template);
        this.manifests.set(toolName, { uiType, hash: '', size: 0 });
      }
    }
  }

  buildHybridComponentPayload(options: Record<string, unknown>): Record<string, unknown> | undefined {
    const toolName = options['toolName'] as string;
    if (!toolName) return undefined;

    const manifest = this.manifests.get(toolName);
    if (!manifest) return undefined;

    return {
      type: manifest['uiType'],
      hash: manifest['hash'],
      toolName,
    };
  }

  async renderAndRegisterAsync(options: Record<string, unknown>): Promise<{ meta: Record<string, unknown> }> {
    const toolName = options['toolName'] as string;
    const uiConfig = options['uiConfig'] as Record<string, unknown> | undefined;
    const template = uiConfig?.['template'];
    const input = options['input'] ?? {};
    const output = options['output'] ?? {};
    const platformType = options['platformType'] as string | undefined;
    const resourceMode = uiConfig?.['resourceMode'] as 'cdn' | 'inline' | undefined;

    if (!toolName || !template) {
      return { meta: {} };
    }

    // Sync resource meta BEFORE render so a render-time failure (graceful
    // degradation) still leaves `_meta.ui.csp` consistent with the current
    // config — same reasoning as compileStaticWidgetAsync.
    this.updateResourceMetaFromConfig(toolName, uiConfig);

    const result = renderToolTemplate({
      toolName,
      input,
      output,
      template,
      platformType,
      resolver: this.resolver,
      resourceMode,
    });

    // Cache the rendered HTML
    this.widgets.set(toolName, result.html);

    return { meta: result.meta };
  }
}

// ============================================
// URI Utilities
// ============================================

export const UI_RESOURCE_SCHEME = 'ui';

export function isUIResourceUri(uri: string): boolean {
  return uri.startsWith('ui://');
}

export function isStaticWidgetUri(uri: string): boolean {
  return uri.startsWith('ui://widget/');
}

export interface ParsedWidgetUri {
  toolName: string;
  extension: string;
}

export function parseWidgetUri(uri: string): ParsedWidgetUri | null {
  const match = uri.match(/^ui:\/\/widget\/([^.]+)\.(\w+)$/);
  if (!match) return null;
  return { toolName: match[1], extension: match[2] };
}

export function buildStaticWidgetUri(toolName: string): string {
  return `ui://widget/${toolName}.html`;
}

export function getUIResourceMimeType(_platformOrUri?: string): string {
  if (_platformOrUri?.endsWith('.js')) return 'application/javascript';
  if (_platformOrUri?.endsWith('.css')) return 'text/css';
  return MCP_APPS_MIME_TYPE;
}
