import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { promptGenerator } from './prompt';

describe('prompt generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a prompt file', async () => {
    await promptGenerator(tree, { name: 'summarize', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/prompts/summarize.prompt.ts')).toBe(true);
  });

  it('should include arguments when provided', async () => {
    await promptGenerator(tree, {
      name: 'summarize',
      project: 'my-app',
      arguments: 'text, maxLength',
      skipFormat: true,
    });

    const content = tree.read('apps/my-app/src/prompts/summarize.prompt.ts', 'utf-8');
    expect(content).toContain("name: 'text'");
    expect(content).toContain("name: 'maxLength'");
  });

  it('should generate without arguments when none provided', async () => {
    await promptGenerator(tree, { name: 'summarize', project: 'my-app' });

    const content = tree.read('apps/my-app/src/prompts/summarize.prompt.ts', 'utf-8');
    expect(content).toContain('class SummarizePrompt extends PromptContext');
  });
});
