import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { workspaceGenerator } from './workspace';

// Mock the app generator to avoid dependency issues in unit tests
jest.mock('../app/app', () => ({
  appGenerator: jest.fn().mockResolvedValue(undefined),
}));

describe('workspace generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should generate workspace root files', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    expect(tree.exists('my-project/nx.json')).toBe(true);
    expect(tree.exists('my-project/tsconfig.base.json')).toBe(true);
    expect(tree.exists('my-project/package.json')).toBe(true);
    expect(tree.exists('my-project/.gitignore')).toBe(true);
    expect(tree.exists('my-project/.prettierrc')).toBe(true);
  });

  it('should create apps, libs, servers directories', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    expect(tree.exists('my-project/apps/.gitkeep')).toBe(true);
    expect(tree.exists('my-project/libs/.gitkeep')).toBe(true);
    expect(tree.exists('my-project/servers/.gitkeep')).toBe(true);
  });

  it('should set package manager in nx.json', async () => {
    await workspaceGenerator(tree, { name: 'my-project', packageManager: 'yarn', skipInstall: true });

    const nxJson = readJson(tree, 'my-project/nx.json');
    expect(nxJson.cli.packageManager).toBe('yarn');
  });

  it('should set workspace name in package.json', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    const packageJson = readJson(tree, 'my-project/package.json');
    expect(packageJson.name).toBe('my-project');
    expect(packageJson.workspaces).toContain('apps/*');
    expect(packageJson.workspaces).toContain('libs/*');
    expect(packageJson.workspaces).toContain('servers/*');
  });

  it('should include frontmcp dependencies', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    const packageJson = readJson(tree, 'my-project/package.json');
    expect(packageJson.dependencies['@frontmcp/sdk']).toBeDefined();
    expect(packageJson.dependencies['@frontmcp/cli']).toBeDefined();
    expect(packageJson.devDependencies['@frontmcp/nx']).toBeDefined();
    expect(packageJson.devDependencies['@frontmcp/testing']).toBeDefined();
  });

  it('should compose with app generator when createSampleApp is true', async () => {
    const { appGenerator } = require('../app/app');
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true, createSampleApp: true });

    expect(appGenerator).toHaveBeenCalledWith(
      tree,
      expect.objectContaining({
        name: 'demo',
        directory: 'my-project/apps/demo',
      }),
    );
  });

  it('should not compose with app generator when createSampleApp is false', async () => {
    const { appGenerator } = require('../app/app');
    (appGenerator as jest.Mock).mockClear();
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true, createSampleApp: false });

    expect(appGenerator).not.toHaveBeenCalled();
  });

  it('should default packageManager to npm', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    const nxJson = readJson(tree, 'my-project/nx.json');
    expect(nxJson.cli.packageManager).toBe('npm');
  });

  it('should return install task when skipInstall is false', async () => {
    const callback = await workspaceGenerator(tree, { name: 'my-project', skipInstall: false });
    expect(typeof callback).toBe('function');
  });

  it('should generate AI agent configuration files', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    expect(tree.exists('my-project/CLAUDE.md')).toBe(true);
    expect(tree.exists('my-project/AGENTS.md')).toBe(true);
    expect(tree.exists('my-project/.mcp.json')).toBe(true);
    expect(tree.exists('my-project/.cursorrules')).toBe(true);
  });

  it('should configure frontmcp-docs MCP server in .mcp.json', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    const mcpJson = readJson(tree, 'my-project/.mcp.json');
    expect(mcpJson.mcpServers['frontmcp-docs']).toBeDefined();
    expect(mcpJson.mcpServers['frontmcp-docs'].url).toBe('https://docs.agentfront.dev/mcp');
  });

  it('should include workspace name in CLAUDE.md', async () => {
    await workspaceGenerator(tree, { name: 'my-project', skipInstall: true });

    const claudeMd = tree.read('my-project/CLAUDE.md', 'utf-8');
    expect(claudeMd).toContain('my-project');
  });

  it('should include package manager in AGENTS.md', async () => {
    await workspaceGenerator(tree, { name: 'my-project', packageManager: 'yarn', skipInstall: true });

    const agentsMd = tree.read('my-project/AGENTS.md', 'utf-8');
    expect(agentsMd).toContain('yarn');
  });
});
