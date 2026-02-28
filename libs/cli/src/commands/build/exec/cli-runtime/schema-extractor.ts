/**
 * Build-time schema extraction.
 * After the server bundle is produced, boots a DirectClient via connect(),
 * extracts tool/resource/prompt schemas, and serializes them for CLI code generation.
 */

export interface ExtractedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ExtractedResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ExtractedResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
}

export interface ExtractedPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface ExtractedSchema {
  tools: ExtractedTool[];
  resources: ExtractedResource[];
  resourceTemplates: ExtractedResourceTemplate[];
  prompts: ExtractedPrompt[];
}

/**
 * Extract schemas from a compiled server bundle.
 * Requires the bundle to export a FrontMcp-decorated class as default export
 * or a config object usable by connect().
 */
export async function extractSchemas(bundlePath: string): Promise<ExtractedSchema> {
  // Lazy-load the server bundle
  const mod = require(bundlePath);
  const configOrClass = mod.default || mod;

  // Use @frontmcp/sdk connect() to boot in-memory client
  let connect: (config: unknown) => Promise<unknown>;
  try {
    const sdk = require('@frontmcp/sdk');
    connect = sdk.connect || sdk.direct?.connect;
    if (!connect) {
      throw new Error('connect() not found in @frontmcp/sdk');
    }
  } catch {
    throw new Error(
      '@frontmcp/sdk is required for CLI schema extraction. Ensure it is installed.',
    );
  }

  const client = await connect(configOrClass) as {
    listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
    listResources(): Promise<{ resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }> }>;
    listResourceTemplates?(): Promise<{ resourceTemplates: Array<{ uriTemplate: string; name?: string; description?: string }> }>;
    listPrompts(): Promise<{ prompts: Array<{ name: string; description?: string; arguments?: unknown[] }> }>;
    close(): Promise<void>;
  };

  try {
    const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
      client.listTools().catch(() => ({ tools: [] })),
      client.listResources().catch(() => ({ resources: [] })),
      client.listPrompts().catch(() => ({ prompts: [] })),
    ]);

    let resourceTemplates: ExtractedResourceTemplate[] = [];
    if (client.listResourceTemplates) {
      try {
        const templatesResult = await client.listResourceTemplates();
        resourceTemplates = (templatesResult.resourceTemplates || []).map((t) => ({
          uriTemplate: t.uriTemplate,
          name: t.name || t.uriTemplate,
          description: t.description,
        }));
      } catch {
        // Resource templates not supported
      }
    }

    const tools: ExtractedTool[] = (toolsResult.tools || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
    }));

    const resources: ExtractedResource[] = (resourcesResult.resources || []).map((r) => ({
      uri: r.uri,
      name: r.name || r.uri,
      description: r.description,
      mimeType: r.mimeType,
    }));

    const prompts: ExtractedPrompt[] = (promptsResult.prompts || []).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments as ExtractedPrompt['arguments'],
    }));

    return { tools, resources, resourceTemplates, prompts };
  } finally {
    await client.close().catch(() => {});
  }
}
