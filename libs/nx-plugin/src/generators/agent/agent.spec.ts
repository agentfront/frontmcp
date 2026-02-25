import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
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
    expect(content).toContain("'search'");
    expect(content).toContain("'summarize'");
  });

  it('should use correct class name', async () => {
    await agentGenerator(tree, { name: 'researcher', project: 'my-app' });

    const content = tree.read('apps/my-app/src/agents/researcher.agent.ts', 'utf-8');
    expect(content).toContain('class ResearcherAgent extends AgentContext');
  });
});
