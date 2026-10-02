import { expect, type Page } from '@playwright/test';

import { installModelContext } from './model-context';

interface PageModelContext {
  getTools(): Promise<Array<{ name: string; title?: string; annotations?: Record<string, boolean> }>>;
  executeTool(tool: { name: string }, input?: object): Promise<string>;
}

declare global {
  interface Document {
    modelContext?: PageModelContext;
  }
}

/** Open the app, with WebMCP available unless `withWebMcp` is false, and wait for its server. */
export async function openApp(page: Page, { withWebMcp = true } = {}): Promise<void> {
  if (withWebMcp) await page.addInitScript(installModelContext);
  await page.goto('/');
  await expect(page.locator('[data-testid="server-status"]')).toHaveText('ready', { timeout: 30_000 });
}

/** The tools registered on `document.modelContext`, as an agent lists them. */
export function webMcpTools(page: Page) {
  return page.evaluate(async () => {
    const tools = (await document.modelContext?.getTools()) ?? [];
    return tools.map(({ name, title, annotations }) => ({ name, title, annotations }));
  });
}

/** Names of the registered tools, sorted. */
export async function webMcpToolNames(page: Page): Promise<string[]> {
  return (await webMcpTools(page)).map((tool) => tool.name).sort();
}

/** Run a tool the way an in-page agent does; resolves to the parsed result. */
export function executeWebMcpTool(page: Page, name: string, input: object = {}): Promise<unknown> {
  return page.evaluate(
    async ([toolName, toolInput]) => {
      const modelContext = document.modelContext;
      if (!modelContext) throw new Error('no document.modelContext');
      return JSON.parse(await modelContext.executeTool({ name: toolName }, toolInput)) as unknown;
    },
    [name, input] as const,
  );
}

/** Every tool the server's `tools:call-tool` flow ran, as the app's plugin hook recorded it. */
export function hookCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__hookCalls ?? []);
}

declare global {
  interface Window {
    __hookCalls?: string[];
  }
}
