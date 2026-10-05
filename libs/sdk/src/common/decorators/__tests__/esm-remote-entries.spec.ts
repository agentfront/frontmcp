import 'reflect-metadata';

import { EsmModuleLoader } from '../../../esm-loader/esm-module-loader';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { McpClientService } from '../../../remote-mcp/mcp-client.service';
import type { McpClientConnection } from '../../../remote-mcp/mcp-client.types';
import { type FrontMcpConfigInput } from '../../metadata';
import { FrontMcpLocalAppTokens, FrontMcpTokens } from '../../tokens';
import { LogLevel } from '../../types';
import { Agent } from '../agent.decorator';
import { App } from '../app.decorator';
import { FrontMcp } from '../front-mcp.decorator';
import { Job } from '../job.decorator';
import { Prompt } from '../prompt.decorator';
import { Resource } from '../resource.decorator';
import { Skill } from '../skill.decorator';
import { Tool } from '../tool.decorator';

const TOOLS_PACKAGE = '@acme/tools@^1.0.0';
const REMOTE_URL = 'https://api.example.com/mcp';

const esmTool = Tool.esm(TOOLS_PACKAGE, 'echo');
const remoteTool = Tool.remote(REMOTE_URL, 'search');
const esmResource = Resource.esm(TOOLS_PACKAGE, 'status');
const remoteResource = Resource.remote(REMOTE_URL, 'system-health');
const esmPrompt = Prompt.esm(TOOLS_PACKAGE, 'greeting');
const remotePrompt = Prompt.remote(REMOTE_URL, 'code-review');
const esmAgent = Agent.esm('@acme/agents@^1.0.0', 'writer');
const remoteAgent = Agent.remote(REMOTE_URL, 'assistant');
const esmSkill = Skill.esm('@acme/skills@^1.0.0', 'deploy');
const remoteSkill = Skill.remote(REMOTE_URL, 'security-audit');
const esmJob = Job.esm('@acme/jobs@^1.0.0', 'cleanup');
const remoteJob = Job.remote(REMOTE_URL, 'sync-data');

@App({
  name: 'external-entries',
  tools: [esmTool, remoteTool],
  resources: [esmResource, remoteResource],
  prompts: [esmPrompt, remotePrompt],
  agents: [esmAgent, remoteAgent],
  skills: [esmSkill, remoteSkill],
  jobs: [esmJob, remoteJob],
})
class ExternalEntriesApp {}

@FrontMcp({
  info: { name: 'external-entries-server', version: '1.0.0' },
  apps: [ExternalEntriesApp],
  tools: [esmTool, remoteTool],
  resources: [esmResource, remoteResource],
  skills: [esmSkill, remoteSkill],
  serve: false,
})
class ExternalEntriesServer {}

@App({
  name: 'loaded-entries',
  tools: [esmTool, remoteTool],
  resources: [esmResource, remoteResource],
  prompts: [esmPrompt, remotePrompt],
})
class LoadedEntriesApp {}

const directConfig: FrontMcpConfigInput = {
  info: { name: 'external-entries-direct', version: '1.0.0' },
  apps: [LoadedEntriesApp],
  tools: [Tool.esm(TOOLS_PACKAGE, 'lookup'), Tool.remote(REMOTE_URL, 'translate')],
  resources: [Resource.esm(TOOLS_PACKAGE, 'quota'), Resource.remote(REMOTE_URL, 'uptime')],
  skills: [Skill.esm('@acme/skills@^1.0.0', 'rollback'), Skill.remote(REMOTE_URL, 'incident-review')],
  jobs: { enabled: true },
  logging: { level: LogLevel.Off },
};

const execute = async () => ({ content: [] });
const read = async (uri: string) => ({ contents: [{ uri, text: 'ok' }] });

describe('.esm() and .remote() entries in decorator arrays', () => {
  it('are kept by @App for every entry kind', () => {
    const appEntries = (token: symbol) => Reflect.getMetadata(token, ExternalEntriesApp);

    expect(appEntries(FrontMcpLocalAppTokens.tools)).toEqual([esmTool, remoteTool]);
    expect(appEntries(FrontMcpLocalAppTokens.resources)).toEqual([esmResource, remoteResource]);
    expect(appEntries(FrontMcpLocalAppTokens.prompts)).toEqual([esmPrompt, remotePrompt]);
    expect(appEntries(FrontMcpLocalAppTokens.agents)).toEqual([esmAgent, remoteAgent]);
    expect(appEntries(FrontMcpLocalAppTokens.skills)).toEqual([esmSkill, remoteSkill]);
    expect(appEntries(FrontMcpLocalAppTokens.jobs)).toEqual([esmJob, remoteJob]);
  });

  it('are kept by @FrontMcp for server-level tools, resources and skills', () => {
    const serverEntries = (token: symbol) => Reflect.getMetadata(token, ExternalEntriesServer);

    expect(serverEntries(FrontMcpTokens.tools)).toEqual([esmTool, remoteTool]);
    expect(serverEntries(FrontMcpTokens.resources)).toEqual([esmResource, remoteResource]);
    expect(serverEntries(FrontMcpTokens.skills)).toEqual([esmSkill, remoteSkill]);
  });
});

describe('.esm() and .remote() entries at startup', () => {
  beforeEach(() => {
    jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValue({
      manifest: {
        name: '@acme/tools',
        version: '1.0.0',
        tools: [
          { name: 'echo', execute },
          { name: 'lookup', execute },
        ],
        resources: [
          { name: 'status', uri: 'acme://status', read },
          { name: 'quota', uri: 'acme://quota', read },
        ],
        prompts: [{ name: 'greeting', execute: async () => ({ messages: [] }) }],
      },
      resolvedVersion: '1.0.0',
      source: 'cache',
      loadedAt: 0,
      rawModule: {},
    });
    jest
      .spyOn(McpClientService.prototype, 'connect')
      .mockImplementation(async () => ({ status: 'connected' }) as unknown as McpClientConnection);
    jest.spyOn(McpClientService.prototype, 'discoverCapabilities').mockResolvedValue({
      tools: [
        { name: 'search', inputSchema: { type: 'object' } },
        { name: 'translate', inputSchema: { type: 'object' } },
      ],
      resources: [
        { name: 'system-health', uri: 'remote://health' },
        { name: 'uptime', uri: 'remote://uptime' },
      ],
      resourceTemplates: [],
      prompts: [{ name: 'code-review' }],
      fetchedAt: new Date(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('load the tools, resources and prompts they name', async () => {
    const server = await FrontMcpInstance.createDirect(directConfig);

    const tools = (await server.listTools()).tools.map((tool) => tool.name);
    const resources = (await server.listResources()).resources.map((resource) => resource.name);
    const prompts = (await server.listPrompts()).prompts.map((prompt) => prompt.name);
    await server.dispose();

    expect(tools).toEqual(expect.arrayContaining(['echo', 'search', 'lookup', 'translate']));
    expect(resources).toEqual(expect.arrayContaining(['status', 'system-health', 'quota', 'uptime']));
    expect(prompts).toEqual(expect.arrayContaining(['greeting', 'code-review']));
  });
});
