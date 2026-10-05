import 'reflect-metadata';

import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
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

const directConfig: FrontMcpConfigInput = {
  info: { name: 'external-entries-direct', version: '1.0.0' },
  apps: [ExternalEntriesApp],
  tools: [Tool.esm('@acme/server-tools@^1.0.0', 'lookup'), Tool.remote(REMOTE_URL, 'translate')],
  resources: [Resource.esm('@acme/server-tools@^1.0.0', 'quota'), Resource.remote(REMOTE_URL, 'uptime')],
  skills: [Skill.esm('@acme/skills@^1.0.0', 'rollback'), Skill.remote(REMOTE_URL, 'incident-review')],
  jobs: { enabled: true },
  logging: { level: LogLevel.Off },
};

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

  it('are accepted by the registries when a server starts', async () => {
    const server = await FrontMcpInstance.createDirect(directConfig);

    await server.dispose();
  });
});
