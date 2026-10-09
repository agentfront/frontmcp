// file: libs/sdk/src/agent/agent-builtin-tools.ts

/**
 * The tools an agent's model reads the agent's resources and prompts with (#699).
 *
 * An agent that declares resources offers its model `list_resources` and `read_resource`; one that
 * declares prompts offers `list_prompts` and `get_prompt`. Each runs through the matching flow of the
 * agent's private scope (`resources:list-resources` and `resources:list-resource-templates`,
 * `resources:read-resource`, `prompts:list-prompts`, `prompts:get-prompt`), so the hooks, authorities
 * and errors that apply to a client's call apply to the model's too.
 */

import { z } from '@frontmcp/lazy-zod';
import {
  type GetPromptResult,
  type ListPromptsResult,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type PromptMessage,
  type ReadResourceResult,
} from '@frontmcp/protocol';

import {
  type AgentToolDefinition,
  type FlowInputOf,
  type FlowName,
  type FlowOutputOf,
  type ScopeEntry,
} from '../common';
import { isOfferedOnSurface, type CallSurface } from '../common/availability';
import { InvalidInputError } from '../errors';
import { errorBehindFlowControl } from '../transport/mcp-handlers/mcp-error.utils';

/** The surface the agent's model reads on: what `availableWhen.surface: ['agent']` offers. */
const AGENT_SURFACE: CallSurface = 'agent';

/** The names of the built-in tools, as the model calls them. */
export const AGENT_BUILTIN_TOOL_NAMES = {
  listResources: 'list_resources',
  readResource: 'read_resource',
  listPrompts: 'list_prompts',
  getPrompt: 'get_prompt',
} as const;

export type AgentBuiltinToolName = (typeof AGENT_BUILTIN_TOOL_NAMES)[keyof typeof AGENT_BUILTIN_TOOL_NAMES];

/** The scope the built-in tools read from: the agent's private scope. */
export type AgentBuiltinToolScope = Pick<ScopeEntry, 'resources' | 'prompts' | 'runFlowForOutput'>;

/** What the built-in tools pass to the flows they run, besides the request. */
export interface AgentBuiltinToolContext {
  /** The auth info of the caller the agent runs for: authorities are evaluated against it. */
  authInfo: unknown;
}

const EMPTY_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false };

/** The definitions the model is sent for each built-in tool. */
export const AGENT_BUILTIN_TOOL_DEFINITIONS: Readonly<Record<AgentBuiltinToolName, AgentToolDefinition>> = {
  list_resources: {
    name: AGENT_BUILTIN_TOOL_NAMES.listResources,
    description:
      'List the resources you can read with read_resource: each resource with its URI, and each resource ' +
      'template with the URI template whose placeholders you fill in.',
    parameters: EMPTY_PARAMETERS,
  },
  read_resource: {
    name: AGENT_BUILTIN_TOOL_NAMES.readResource,
    description:
      'Read a resource by its URI: one list_resources lists, or a resource template URI with its ' +
      'placeholders filled in. Returns the text of the resource; binary content is described, not included.',
    parameters: {
      type: 'object',
      properties: { uri: { type: 'string', description: 'The URI of the resource to read' } },
      required: ['uri'],
      additionalProperties: false,
    },
  },
  list_prompts: {
    name: AGENT_BUILTIN_TOOL_NAMES.listPrompts,
    description: 'List the prompts you can get with get_prompt, with the arguments each one takes.',
    parameters: EMPTY_PARAMETERS,
  },
  get_prompt: {
    name: AGENT_BUILTIN_TOOL_NAMES.getPrompt,
    description: 'Get a prompt by its name, with its arguments filled in. Returns its messages as text.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the prompt, as list_prompts lists it' },
        arguments: {
          type: 'object',
          description: "The prompt's arguments, by name",
          additionalProperties: { type: 'string' },
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
};

const readResourceArgsSchema = z.object({ uri: z.string().min(1) });

const getPromptArgsSchema = z.object({
  name: z.string().min(1),
  // A prompt's arguments are strings; a model that sends a number or a boolean means its text
  arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/**
 * The built-in tools the model is offered for what `scope` holds: the resource tools when it holds a
 * resource or resource template, the prompt tools when it holds a prompt. Entries whose
 * `availableWhen` leaves out the agent surface, or this environment, don't count.
 */
export function offeredAgentBuiltinTools(
  scope: Pick<AgentBuiltinToolScope, 'resources' | 'prompts'>,
): AgentBuiltinToolName[] {
  const offered = (entry: { metadata: { availableWhen?: Parameters<typeof isOfferedOnSurface>[0] } }) =>
    isOfferedOnSurface(entry.metadata.availableWhen, AGENT_SURFACE);
  const hasResources =
    scope.resources.getResources(true).some(offered) || scope.resources.getResourceTemplates().some(offered);
  const hasPrompts = scope.prompts.getPrompts(true).some(offered);
  return [
    ...(hasResources ? [AGENT_BUILTIN_TOOL_NAMES.listResources, AGENT_BUILTIN_TOOL_NAMES.readResource] : []),
    ...(hasPrompts ? [AGENT_BUILTIN_TOOL_NAMES.listPrompts, AGENT_BUILTIN_TOOL_NAMES.getPrompt] : []),
  ];
}

/**
 * Run a built-in tool through the flows of `scope`, and return what the model reads: the text of a
 * resource or prompt, or a listing (which the agent loop sends as JSON). A flow's error (an unknown
 * URI or prompt name, a denied authority) is thrown as it is, so the model reads it as the tool's error.
 */
export async function runAgentBuiltinTool(
  scope: AgentBuiltinToolScope,
  name: AgentBuiltinToolName,
  args: Record<string, unknown>,
  context: AgentBuiltinToolContext,
): Promise<unknown> {
  // The agent surface (`availableWhen.surface`), and a call the agent's own scope makes: the caller's
  // `publicAccess` was checked on the agent's invoke tool, as for the agent's own tools.
  const ctx = { authInfo: context.authInfo, surface: AGENT_SURFACE, agentPrivateCall: true };
  const run = <Name extends FlowName>(flow: Name, input: FlowInputOf<Name>): Promise<FlowOutputOf<Name>> =>
    scope.runFlowForOutput(flow, input).catch((error: unknown) => {
      // A flow that ended with `this.fail(error)` reports that error
      throw errorBehindFlowControl(error);
    });

  switch (name) {
    case 'list_resources': {
      const [listed, templates] = await Promise.all([
        run('resources:list-resources', { request: { method: 'resources/list', params: {} }, ctx }),
        run('resources:list-resource-templates', { request: { method: 'resources/templates/list', params: {} }, ctx }),
      ]);
      return describeResourceListing(listed, templates);
    }
    case 'read_resource': {
      const { uri } = parseArgs(name, readResourceArgsSchema, args);
      const result = await run('resources:read-resource', {
        request: { method: 'resources/read', params: { uri } },
        ctx,
      });
      return resourceContentsToText(result);
    }
    case 'list_prompts': {
      const listed = await run('prompts:list-prompts', { request: { method: 'prompts/list', params: {} }, ctx });
      return describePromptListing(listed);
    }
    case 'get_prompt': {
      const parsed = parseArgs(name, getPromptArgsSchema, args);
      const promptArgs = parsed.arguments
        ? Object.fromEntries(Object.entries(parsed.arguments).map(([key, value]) => [key, String(value)]))
        : undefined;
      const result = await run('prompts:get-prompt', {
        request: { method: 'prompts/get', params: { name: parsed.name, ...(promptArgs && { arguments: promptArgs }) } },
        ctx,
      });
      return promptResultToText(result);
    }
  }
}

function parseArgs<T>(tool: AgentBuiltinToolName, schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const parsed = schema.safeParse(args);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`);
  throw new InvalidInputError(`Invalid arguments for ${tool}: ${issues.join('; ')}`, parsed.error.issues);
}

// ============================================================================
// Results as the model reads them
// ============================================================================

/** The listing `list_resources` returns: what the model needs to pick a URI. */
export function describeResourceListing(listed: ListResourcesResult, templates: ListResourceTemplatesResult) {
  return {
    resources: listed.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      ...(resource.title !== undefined && { title: resource.title }),
      ...(resource.description !== undefined && { description: resource.description }),
      ...(resource.mimeType !== undefined && { mimeType: resource.mimeType }),
    })),
    resourceTemplates: templates.resourceTemplates.map((template) => ({
      uriTemplate: template.uriTemplate,
      name: template.name,
      ...(template.title !== undefined && { title: template.title }),
      ...(template.description !== undefined && { description: template.description }),
      ...(template.mimeType !== undefined && { mimeType: template.mimeType }),
    })),
  };
}

/** The listing `list_prompts` returns: each prompt with the arguments it takes. */
export function describePromptListing(listed: ListPromptsResult) {
  return {
    prompts: listed.prompts.map((prompt) => ({
      name: prompt.name,
      ...(prompt.title !== undefined && { title: prompt.title }),
      ...(prompt.description !== undefined && { description: prompt.description }),
      ...(prompt.arguments !== undefined && {
        arguments: prompt.arguments.map((argument) => ({
          name: argument.name,
          ...(argument.description !== undefined && { description: argument.description }),
          ...(argument.required !== undefined && { required: argument.required }),
        })),
      }),
    })),
  };
}

/**
 * A resource read as the model reads it. A single text content is its text as it is. Several contents
 * are each headed by their URI (and MIME type). Binary (`blob`) content is never sent to the model: it
 * is replaced by a one-line description with its URI, MIME type and size.
 */
export function resourceContentsToText(result: ReadResourceResult): string {
  const { contents } = result;
  if (contents.length === 0) return '(the resource has no content)';
  const [only] = contents;
  if (contents.length === 1 && 'text' in only) return only.text;

  return contents
    .map((content) => {
      if (!('text' in content)) return describeBinary(content.uri, content.mimeType, content.blob);
      return `[${content.uri}]${content.mimeType ? ` (${content.mimeType})` : ''}\n${content.text}`;
    })
    .join('\n\n');
}

/**
 * A prompt as the model reads it: its description, then each message headed by its role. Text is kept
 * as it is, an embedded text resource is inlined, and anything binary (an image, audio, a blob
 * resource) is replaced by a one-line description. A resource link is named by its URI, which
 * `read_resource` can read.
 */
export function promptResultToText(result: GetPromptResult): string {
  const parts = result.messages.map((message) => `[${message.role}]\n${promptContentToText(message.content)}`);
  return [...(result.description ? [result.description] : []), ...parts].join('\n\n');
}

function promptContentToText(content: PromptMessage['content']): string {
  switch (content.type) {
    case 'text':
      return content.text;
    case 'image':
      return `[image omitted (${content.mimeType})]`;
    case 'audio':
      return `[audio omitted (${content.mimeType})]`;
    case 'resource_link':
      return `[resource link: ${content.uri}${content.name ? ` (${content.name})` : ''}]`;
    case 'resource': {
      const resource = content.resource;
      if ('text' in resource) return resource.text;
      return describeBinary(resource.uri, resource.mimeType, resource.blob);
    }
    default:
      return `[${(content as { type: string }).type} content omitted]`;
  }
}

function describeBinary(uri: string, mimeType: string | undefined, base64: string): string {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  return `[binary content omitted: ${uri} (${mimeType ?? 'application/octet-stream'}, ${bytes} bytes)]`;
}
