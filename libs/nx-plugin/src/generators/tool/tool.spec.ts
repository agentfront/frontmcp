import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { toolGenerator } from './tool';

describe('tool generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a tool file', async () => {
    await toolGenerator(tree, { name: 'calculate', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/tools/calculate.tool.ts')).toBe(true);
  });

  it('should use correct class name', async () => {
    await toolGenerator(tree, { name: 'calculate', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/tools/calculate.tool.ts', 'utf-8');
    expect(content).toContain('class CalculateTool extends ToolContext');
    expect(content).toContain("name: 'calculate'");
  });

  it('should generate in subdirectory when specified', async () => {
    await toolGenerator(tree, { name: 'calculate', project: 'my-app', directory: 'math', skipFormat: true });

    expect(tree.exists('apps/my-app/src/tools/math/calculate.tool.ts')).toBe(true);
  });

  it('should throw when project does not exist', async () => {
    await expect(toolGenerator(tree, { name: 'calculate', project: 'non-existent' })).rejects.toThrow(
      'Project "non-existent" not found',
    );
  });

  it('should handle kebab-case names', async () => {
    await toolGenerator(tree, { name: 'my-calculator', project: 'my-app' });

    expect(tree.exists('apps/my-app/src/tools/my-calculator.tool.ts')).toBe(true);
    const content = tree.read('apps/my-app/src/tools/my-calculator.tool.ts', 'utf-8');
    expect(content).toContain('class MyCalculatorTool');
  });
});
