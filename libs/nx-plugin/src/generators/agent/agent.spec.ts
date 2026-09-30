import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { agentGenerator } from './agent';

describe('agent generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate an agent file', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/agents/researcher.agent.ts')).toBe(true);
  });

  it('should use default model when not specified', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain("model: 'gpt-4'");
  });

  it('should use custom model when specified', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', model: 'claude-3-opus', skipFormat: true });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain("model: 'claude-3-opus'");
  });

  it('should include tool references when provided', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', tools: 'search, summarize', skipFormat: true });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain("import SearchTool from '../tools/search.tool';");
    expect(content).toContain("import SummarizeTool from '../tools/summarize.tool';");
    expect(content).toContain('tools: [SearchTool, SummarizeTool]');
    expect(content).not.toContain("'search'");
  });

  it('should import each tool once when the tool list repeats a name', async () => {
    await agentGenerator(tree, {
      name: 'researcher',
      project: 'my-app',
      tools: 'search, search, Search',
      skipFormat: true,
    });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8') as string;
    expect(content.match(/import SearchTool/g)).toHaveLength(1);
    expect(content).toContain('tools: [SearchTool]');
  });

  it('should point tool imports at the tools folder from a nested directory', async () => {
    await agentGenerator(tree, {
      name: 'researcher',
      project: 'my-app',
      tools: 'search',
      directory: 'team/a',
      skipFormat: true,
    });

    const content = tree.read('apps/my-app/src/agents/team/a/researcher.agent.ts', 'utf-8');
    expect(content).toContain("import SearchTool from '../../../tools/search.tool';");
  });

  it('should configure the anthropic provider for claude models', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', model: 'claude-sonnet-4', skipFormat: true });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain("provider: 'anthropic'");
    expect(content).toContain("apiKey: { env: 'ANTHROPIC_API_KEY' }");
  });

  it('should configure the openai provider by default', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain("provider: 'openai'");
    expect(content).toContain("apiKey: { env: 'OPENAI_API_KEY' }");
  });

  it('should use correct class name', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app' });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain('class ResearcherAgent extends AgentContext');
  });

  it('should export default', async () => {
    const mod = await import('./agent');
    expect(mod.default).toBe(agentGenerator);
  });
});
