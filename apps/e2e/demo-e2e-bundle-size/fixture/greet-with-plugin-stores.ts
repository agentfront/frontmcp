import { CachePlugin, type CachePluginOptions } from '@frontmcp/plugin-cache';
import { RememberPlugin, type RememberPluginOptionsInput } from '@frontmcp/plugin-remember';
import { create, Tool, ToolContext, z } from '@frontmcp/sdk';

class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

type PluginStoreOptions = Omit<Parameters<typeof create>[0], 'info'> & {
  cache?: CachePluginOptions;
  remember?: RememberPluginOptionsInput;
};

/** Start a server with CachePlugin or RememberPlugin on these options, as a page would, and call its tool. */
export async function greetWith({ cache, remember, ...options }: PluginStoreOptions): Promise<unknown> {
  const plugins = [...(cache ? [CachePlugin.init(cache)] : []), ...(remember ? [RememberPlugin.init(remember)] : [])];
  const server = await create({
    info: { name: 'browser-plugin-stores', version: '1.0.0' },
    tools: [GreetTool],
    plugins,
    ...options,
  });
  try {
    return await server.callTool('greet', { name: 'FrontMCP' });
  } finally {
    await server.dispose();
  }
}
