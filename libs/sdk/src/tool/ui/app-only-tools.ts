// file: libs/sdk/src/tool/ui/app-only-tools.ts

/** Whether a tool is for its MCP Apps page only: its `_meta.ui.visibility` (SEP-1865) leaves out `'model'`. */
export function isAppOnlyTool(metadata: { _meta?: Record<string, unknown> }): boolean {
  const ui = metadata._meta?.['ui'];
  const visibility = typeof ui === 'object' && ui !== null ? Reflect.get(ui, 'visibility') : undefined;
  return Array.isArray(visibility) && !visibility.includes('model');
}

/** The first platform known for the caller, in the order given: what it negotiated before a user-agent guess. */
export function knownPlatformOf(...platforms: Array<string | undefined>): string | undefined {
  return platforms.find((platform) => platform !== undefined && platform !== 'unknown');
}

/** Whether a client on this platform renders MCP Apps pages, so a tool for the page alone is listed and callable. */
export function rendersAppPages(platformType: string | undefined): boolean {
  return platformType === 'ext-apps' || platformType === 'openai';
}
