/**
 * Shared UI utilities and types
 *
 * Internal module to avoid circular imports between index.ts and ui-resource.handler.ts.
 */

// ============================================
// ToolUIRegistry (stub)
// ============================================

/** Stub ToolUIRegistry */
export class ToolUIRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private widgets = new Map<string, any>();

  getStaticWidget(name: string): string | undefined {
    return this.widgets.get(name);
  }

  hasAny(): boolean {
    return this.widgets.size > 0;
  }

  getManifest(_toolName: string): Record<string, unknown> | undefined {
    return undefined;
  }

  detectUIType(_template: unknown): string {
    return 'auto';
  }

  async compileStaticWidgetAsync(_options: Record<string, unknown>): Promise<void> {
    // Stub — no-op until re-implemented
  }

  async compileLeanWidgetAsync(_options: Record<string, unknown>): Promise<void> {
    // Stub — no-op until re-implemented
  }

  async compileHybridWidgetAsync(_options: Record<string, unknown>): Promise<void> {
    // Stub — no-op until re-implemented
  }

  buildHybridComponentPayload(_options: Record<string, unknown>): Record<string, unknown> | undefined {
    return undefined;
  }

  async renderAndRegisterAsync(_options: Record<string, unknown>): Promise<{ meta: Record<string, unknown> }> {
    return { meta: {} };
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
  if (_platformOrUri?.endsWith('.html')) return 'text/html';
  if (_platformOrUri?.endsWith('.js')) return 'application/javascript';
  if (_platformOrUri?.endsWith('.css')) return 'text/css';
  return 'text/html';
}
