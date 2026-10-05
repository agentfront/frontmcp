import { sha256Hex } from '@frontmcp/utils';

import {
  type FrontMcpLogger,
  type PromptRecord,
  type PromptRemoteRecord,
  type RemoteAuthConfig,
  type RemoteTransportOptions,
  type ResourceRecord,
  type ResourceRemoteRecord,
  type ResourceTemplateRecord,
  type ScopeEntry,
  type ToolRecord,
  type ToolRemoteRecord,
} from '../common';
import { pickExternalEntry, type ExternalEntryCandidate } from '../common/utils/external-entry.utils';
import { ExternalEntryLoadError, type ExternalEntryKind } from '../errors/external-entry.errors';
import {
  buildRemotePromptRecord,
  buildRemoteResourceRecord,
  buildRemoteResourceTemplateRecord,
  buildRemoteToolRecord,
} from './factories/record-builders';
import { McpClientService } from './mcp-client.service';
import type {
  McpClientServiceOptions,
  McpConnectRequest,
  McpRemoteAuthConfig,
  McpRemoteCapabilities,
  McpTransportType,
} from './mcp-client.types';

interface ScopeWithMcpClient {
  logger: FrontMcpLogger;
  mcpClientService?: McpClientService;
}

/** The scope's MCP client, created by the first remote app or `.remote()` entry that connects. */
export function mcpClientServiceOf(scope: ScopeWithMcpClient, options?: McpClientServiceOptions): McpClientService {
  if (!scope.mcpClientService) {
    scope.mcpClientService = new McpClientService(scope.logger, options);
  }
  return scope.mcpClientService;
}

/** The request that connects `appId` to the MCP server at `url`. */
export function buildRemoteConnectRequest(target: {
  appId: string;
  name: string;
  url: string;
  transportType?: McpTransportType;
  transportOptions?: RemoteTransportOptions;
  remoteAuth?: RemoteAuthConfig;
  namespace?: string;
}): McpConnectRequest {
  const { transportOptions } = target;
  return {
    appId: target.appId,
    name: target.name,
    transportType: target.transportType ?? 'http',
    url: target.url,
    transportOptions: {
      timeout: transportOptions?.timeout,
      retryAttempts: transportOptions?.retryAttempts,
      retryDelayMs: transportOptions?.retryDelayMs,
      fallbackToSSE: transportOptions?.fallbackToSSE,
      headers: transportOptions?.headers,
      protocolVersion: transportOptions?.protocolVersion,
    },
    auth: target.remoteAuth as McpRemoteAuthConfig | undefined,
    namespace: target.namespace,
  };
}

type RemoteEntrySource = Pick<ToolRemoteRecord, 'url' | 'targetName' | 'transportOptions' | 'remoteAuth'>;

interface RemoteEntryServer {
  client: McpClientService;
  appId: string;
  capabilities: McpRemoteCapabilities;
}

const remoteServersByScope = new WeakMap<object, Map<string, Promise<RemoteEntryServer>>>();

async function connectRemoteEntryServer(scope: ScopeEntry, source: RemoteEntrySource): Promise<RemoteEntryServer> {
  const client = mcpClientServiceOf(scope);
  const appId = `remote-entry-${sha256Hex(source.url).slice(0, 16)}`;
  await client.connect(
    buildRemoteConnectRequest({
      appId,
      name: appId,
      url: source.url,
      transportOptions: source.transportOptions,
      remoteAuth: source.remoteAuth,
    }),
  );
  const capabilities = client.getCapabilities(appId) ?? (await client.discoverCapabilities(appId));
  return { client, appId, capabilities };
}

/** Connects to a server once per scope, however many `.remote()` entries name its URL. */
function connectOnce(scope: ScopeEntry, source: RemoteEntrySource): Promise<RemoteEntryServer> {
  let servers = remoteServersByScope.get(scope);
  if (!servers) {
    servers = new Map();
    remoteServersByScope.set(scope, servers);
  }
  let server = servers.get(source.url);
  if (!server) {
    server = connectRemoteEntryServer(scope, source);
    servers.set(source.url, server);
  }
  return server;
}

/** The proxy record of the entry a `.remote()` entry names, with its metadata overrides. */
async function loadRemoteEntry<R extends { metadata: object }>(
  scope: ScopeEntry,
  entryKind: ExternalEntryKind,
  record: RemoteEntrySource & { options?: { metadata?: object } },
  candidatesOf: (server: RemoteEntryServer) => ExternalEntryCandidate<R>[],
): Promise<R> {
  const server = await connectOnce(scope, record).catch((error: unknown) => {
    throw new ExternalEntryLoadError(entryKind, record.targetName, record.url, error);
  });
  return pickExternalEntry(entryKind, record, candidatesOf(server), record.options?.metadata);
}

/** The proxy of the tool a `Tool.remote()` entry names. */
export function loadRemoteToolEntry(scope: ScopeEntry, record: ToolRemoteRecord): Promise<ToolRecord> {
  return loadRemoteEntry<ToolRecord>(scope, 'tool', record, ({ client, appId, capabilities }) =>
    capabilities.tools.map((tool) => ({
      name: tool.name,
      toRecord: () => buildRemoteToolRecord(tool, client, appId),
    })),
  );
}

/** The proxy of the resource or resource template a `Resource.remote()` entry names. */
export function loadRemoteResourceEntry(
  scope: ScopeEntry,
  record: ResourceRemoteRecord,
): Promise<ResourceRecord | ResourceTemplateRecord> {
  return loadRemoteEntry<ResourceRecord | ResourceTemplateRecord>(
    scope,
    'resource',
    record,
    ({ client, appId, capabilities }) => [
      ...capabilities.resources.map((resource) => ({
        name: resource.name,
        toRecord: () => buildRemoteResourceRecord(resource, client, appId),
      })),
      ...capabilities.resourceTemplates.map((template) => ({
        name: template.name,
        toRecord: () => buildRemoteResourceTemplateRecord(template, client, appId),
      })),
    ],
  );
}

/** The proxy of the prompt a `Prompt.remote()` entry names. */
export function loadRemotePromptEntry(scope: ScopeEntry, record: PromptRemoteRecord): Promise<PromptRecord> {
  return loadRemoteEntry<PromptRecord>(scope, 'prompt', record, ({ client, appId, capabilities }) =>
    capabilities.prompts.map((prompt) => ({
      name: prompt.name,
      toRecord: () => buildRemotePromptRecord(prompt, client, appId),
    })),
  );
}
