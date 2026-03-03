/**
 * Shared UI utilities and types
 *
 * Internal module to avoid circular imports between index.ts and ui-resource.handler.ts.
 */

import { renderToolTemplate, detectUIType as uipackDetectUIType } from '@frontmcp/uipack/adapters';
import { MCP_APPS_MIME_TYPE } from '@frontmcp/uipack/adapters';
import type { ImportResolver } from '@frontmcp/uipack/resolver';

// ============================================
// ToolUIRegistry
// ============================================

/** Tool UI Registry — manages compiled widgets and rendering. */
export class ToolUIRegistry {
  private widgets = new Map<string, string>();
  private manifests = new Map<string, Record<string, unknown>>();
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

  detectUIType(template: unknown): string {
    return uipackDetectUIType(template);
  }

  async compileStaticWidgetAsync(options: Record<string, unknown>): Promise<void> {
    const toolName = options['toolName'] as string;
    const template = options['template'];
    const input = options['input'] ?? {};
    const output = options['output'] ?? {};

    if (!toolName || !template) return;

    const result = renderToolTemplate({
      toolName,
      input,
      output,
      template,
      resolver: this.resolver,
    });

    this.widgets.set(toolName, result.html);
    this.manifests.set(toolName, {
      uiType: result.uiType,
      hash: result.hash,
      size: result.size,
    });
  }

  async compileLeanWidgetAsync(options: Record<string, unknown>): Promise<void> {
    // Lean mode uses same logic as static for now
    await this.compileStaticWidgetAsync(options);
  }

  async compileHybridWidgetAsync(options: Record<string, unknown>): Promise<void> {
    // Hybrid compiles the shell but not data
    await this.compileStaticWidgetAsync(options);
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
    const template = (options['uiConfig'] as Record<string, unknown> | undefined)?.['template'];
    const input = options['input'] ?? {};
    const output = options['output'] ?? {};
    const platformType = options['platformType'] as string | undefined;

    if (!toolName || !template) {
      return { meta: {} };
    }

    const result = renderToolTemplate({
      toolName,
      input,
      output,
      template,
      platformType,
      resolver: this.resolver,
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
