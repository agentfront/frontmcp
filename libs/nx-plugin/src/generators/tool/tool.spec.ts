import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

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

  it('should derive execute() types from schemas (issue #405)', async () => {
    await toolGenerator(tree, { name: 'calculate', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/tools/calculate.tool.ts', 'utf-8');
    // The template MUST emit derived types via ToolInputOf / ToolOutputOf
    // so the schema stays the single source of truth (issue #405).
    expect(content).toContain('ToolInputOf');
    expect(content).toContain('ToolOutputOf');
    expect(content).toContain('type CalculateInput = ToolInputOf<{ inputSchema: typeof inputSchema }>');
    expect(content).toContain('type CalculateOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>');
    expect(content).toContain('execute(input: CalculateInput): Promise<CalculateOutput>');
    // The decorator config (name, description) MUST stay inline so the @Tool
    // block remains self-contained — only the schemas are hoisted.
    expect(content).toContain("name: 'calculate'");
    // And MUST NOT emit the legacy inline-shape annotation that hand-typed
    // the input next to the schema — the pattern #405 specifically removes.
    expect(content).not.toContain('async execute(input: { value: string }');
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

  it('should export default', async () => {
    const mod = await import('./tool');
    expect(mod.default).toBe(toolGenerator);
  });
});
