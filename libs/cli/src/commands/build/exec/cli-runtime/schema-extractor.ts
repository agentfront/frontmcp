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

export interface ExtractedJob {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  tags?: string[];
}

export interface ExtractedCapabilities {
  skills: boolean;
  jobs: boolean;
  workflows: boolean;
}

export interface ExtractedSchema {
  tools: ExtractedTool[];
  resources: ExtractedResource[];
  resourceTemplates: ExtractedResourceTemplate[];
  prompts: ExtractedPrompt[];
  jobs: ExtractedJob[];
  capabilities: ExtractedCapabilities;
}

/** Known system tool names injected by SDK features (skills, jobs, workflows). */
export const SYSTEM_TOOL_NAMES = new Set([
  'searchSkills',
  'loadSkills',
  'list-jobs',
  'execute-job',
  'get-job-status',
  'register-job',
  'remove-job',
  'list-workflows',
  'execute-workflow',
  'get-workflow-status',
  'register-workflow',
  'remove-workflow',
]);

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
    listTools(): Promise<unknown>;
    listResources(): Promise<{ resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }> }>;
    listResourceTemplates?(): Promise<{ resourceTemplates: Array<{ uriTemplate: string; name?: string; description?: string }> }>;
    listPrompts(): Promise<{ prompts: Array<{ name: string; description?: string; arguments?: unknown[] }> }>;
    listJobs?(): Promise<{ jobs: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown>; tags?: string[] }>; count: number }>;
    close(): Promise<void>;
  };

  try {
    const [toolsRaw, resourcesResult, promptsResult] = await Promise.all([
      client.listTools().catch(() => []),
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

    // DirectClient.listTools() returns FormattedTools (array) directly,
    // not { tools: [...] } like the raw MCP client
    const toolsList = Array.isArray(toolsRaw)
      ? toolsRaw as Array<{ name: string; description?: string; inputSchema?: unknown }>
      : ((toolsRaw as { tools?: unknown[] })?.tools || []) as Array<{ name: string; description?: string; inputSchema?: unknown }>;

    const tools: ExtractedTool[] = toolsList.map((t) => ({
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

    const toolNameSet = new Set(tools.map((t) => t.name));
    const capabilities: ExtractedCapabilities = {
      skills: toolNameSet.has('searchSkills') || toolNameSet.has('loadSkills'),
      jobs: toolNameSet.has('execute-job') || toolNameSet.has('get-job-status'),
      workflows: toolNameSet.has('execute-workflow') || toolNameSet.has('get-workflow-status'),
    };

    // Extract job schemas if jobs capability is available
    let jobs: ExtractedJob[] = [];
    if (capabilities.jobs && client.listJobs) {
      try {
        const jobsResult = await client.listJobs();
        jobs = (jobsResult.jobs || []).map((j) => ({
          name: j.name,
          description: j.description,
          inputSchema: j.inputSchema,
          tags: j.tags,
        }));
      } catch {
        // Jobs listing not available at build time
      }
    }

    return { tools, resources, resourceTemplates, prompts, jobs, capabilities };
  } finally {
    await client.close().catch(() => {});
  }
}
