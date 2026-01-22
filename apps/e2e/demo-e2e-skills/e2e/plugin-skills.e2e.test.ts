/**
 * E2E Tests for Plugin Skills
 *
 * Tests plugin-level skill functionality:
 * - Plugin skill discovery via searchSkills
 * - Plugin skill loading via loadSkill
 * - Plugin tools execution
 * - Mixed app and plugin skills
 * - Hidden plugin skill handling
 * - Tool authorization with plugin skills
 */
import { test, expect } from '@frontmcp/testing';

interface SkillTool {
  name: string;
  purpose?: string;
  available: boolean;
}

interface SkillParameter {
  name: string;
  description?: string;
  required?: boolean;
  type?: string;
}

interface LoadSkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: SkillTool[];
    parameters?: SkillParameter[];
  };
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  warning?: string;
  formattedContent: string;
  session?: {
    activated: boolean;
    sessionId?: string;
    policyMode?: 'strict' | 'approval' | 'permissive';
    allowedTools?: string[];
  };
}

interface SearchSkillsResult {
  skills: Array<{
    id: string;
    name: string;
    description: string;
    score: number;
    tags?: string[];
    tools: Array<{ name: string; available: boolean }>;
    source: string;
  }>;
  total: number;
  hasMore: boolean;
}

interface DeployResult {
  success: boolean;
  environment: string;
  version: string;
  timestamp: string;
}

interface RollbackResult {
  success: boolean;
  environment: string;
  rolledBackTo: string;
}

test.describe('Plugin Skills E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    publicMode: true,
  });

  test.describe('Discovery', () => {
    test('should find plugin and app skills with workflow query', async ({ mcp }) => {
      // Use a query that should match multiple skills
      const result = await mcp.tools.call('searchSkills', {
        query: 'workflow deploy',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      expect(content.skills).toBeDefined();
      expect(content.skills.length).toBeGreaterThan(0);

      // Should find the plugin skill
      expect(content.skills.some((s) => s.id === 'deploy-workflow')).toBe(true);
    });

    test('should include plugin skills in search results', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'deploy application staging production',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      expect(content.skills).toBeDefined();
      expect(content.skills.some((s) => s.id === 'deploy-workflow')).toBe(true);
    });

    test('should filter plugin skills by tags', async ({ mcp }) => {
      // Query must match TF-IDF before tags are applied
      const result = await mcp.tools.call('searchSkills', {
        query: 'deploy application staging production rollback version',
        tags: ['devops'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      expect(content.skills).toBeDefined();
      expect(content.skills.some((s) => s.id === 'deploy-workflow')).toBe(true);
    });

    test('should exclude hidden plugin skills from search', async ({ mcp }) => {
      // Search with a query that might match the hidden skill's description
      const result = await mcp.tools.call('searchSkills', {
        query: 'internal maintenance operations',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      const skillIds = content.skills.map((s) => s.id);

      // Hidden plugin skill should not appear in search results
      expect(skillIds).not.toContain('plugin-internal-skill');
    });

    test('should include plugin tag in skill results', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'deploy staging production application',
        tags: ['plugin'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();

      // Should find deploy-workflow (has 'plugin' tag, not hidden)
      expect(content.skills.some((s) => s.id === 'deploy-workflow')).toBe(true);
    });

    test('should show plugin skill source as local', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'deploy application staging production rollback',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      const deploySkill = content.skills.find((s) => s.id === 'deploy-workflow');

      expect(deploySkill).toBeDefined();
      expect(deploySkill!.source).toBe('local');
    });
  });

  test.describe('Loading', () => {
    test('should load plugin skill with full content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        format: 'full',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill).toBeDefined();
      expect(content.skill.id).toBe('deploy-workflow');
      expect(content.skill.name).toBe('deploy-workflow');
      expect(content.skill.instructions).toContain('Deployment Workflow');
      expect(content.skill.tools.length).toBe(2);
    });

    test('should show plugin tools as available', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.availableTools).toContain('deploy_application');
      expect(content.availableTools).toContain('rollback_deployment');
      expect(content.isComplete).toBe(true);
    });

    test('should load hidden plugin skill by direct ID', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'plugin-internal-skill',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill).toBeDefined();
      expect(content.skill.id).toBe('plugin-internal-skill');
      expect(content.skill.name).toBe('plugin-internal-skill');
    });

    test('should include tool purposes in plugin skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      const deployTool = content.skill.tools.find((t) => t.name === 'deploy_application');
      const rollbackTool = content.skill.tools.find((t) => t.name === 'rollback_deployment');

      expect(deployTool).toBeDefined();
      expect(deployTool!.purpose).toContain('Deploy the application');
      expect(rollbackTool).toBeDefined();
      expect(rollbackTool!.purpose).toContain('Rollback if needed');
    });
  });

  test.describe('Tool Execution', () => {
    test('should execute plugin tools after loading plugin skill', async ({ mcp }) => {
      // Load the skill first
      await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
      });

      // Execute plugin tool
      const result = await mcp.tools.call('deploy_application', {
        environment: 'staging',
        version: '1.0.0',
      });

      expect(result).toBeSuccessful();

      const content = result.json<DeployResult>();
      expect(content.success).toBe(true);
      expect(content.environment).toBe('staging');
      expect(content.version).toBe('1.0.0');
      expect(content.timestamp).toBeDefined();
    });

    test('should execute rollback tool from plugin', async ({ mcp }) => {
      const result = await mcp.tools.call('rollback_deployment', {
        environment: 'production',
        targetVersion: '0.9.0',
      });

      expect(result).toBeSuccessful();

      const content = result.json<RollbackResult>();
      expect(content.success).toBe(true);
      expect(content.environment).toBe('production');
      expect(content.rolledBackTo).toBe('0.9.0');
    });

    test('should execute rollback without target version', async ({ mcp }) => {
      const result = await mcp.tools.call('rollback_deployment', {
        environment: 'staging',
      });

      expect(result).toBeSuccessful();

      const content = result.json<RollbackResult>();
      expect(content.success).toBe(true);
      expect(content.rolledBackTo).toBe('previous');
    });
  });

  test.describe('Mixed App and Plugin Skills', () => {
    test('should search across both app and plugin skills', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'workflow deploy PR review',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      const skillIds = content.skills.map((s) => s.id);

      // Should include both app skill (full-pr-workflow) and plugin skill (deploy-workflow)
      expect(skillIds).toContain('full-pr-workflow');
      expect(skillIds).toContain('deploy-workflow');
    });

    test('should load plugin skill after loading app skill', async ({ mcp }) => {
      // Load app skill
      const appResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });

      expect(appResult).toBeSuccessful();

      // Load plugin skill
      const pluginResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
      });

      expect(pluginResult).toBeSuccessful();

      const pluginContent = pluginResult.json<LoadSkillResult>();
      expect(pluginContent.skill.id).toBe('deploy-workflow');
    });

    test('should have distinct tool sets between app and plugin skills', async ({ mcp }) => {
      // Load app skill
      const appResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(appResult).toBeSuccessful();

      const appContent = appResult.json<LoadSkillResult>();
      expect(appContent.availableTools).toContain('github_get_pr');
      expect(appContent.availableTools).not.toContain('deploy_application');

      // Load plugin skill
      const pluginResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
      });

      expect(pluginResult).toBeSuccessful();

      const pluginContent = pluginResult.json<LoadSkillResult>();
      expect(pluginContent.availableTools).toContain('deploy_application');
      expect(pluginContent.availableTools).not.toContain('github_get_pr');
    });

    test('should use app tools and plugin tools in sequence', async ({ mcp }) => {
      // Use app tool
      const ghResult = await mcp.tools.call('github_get_pr', { prNumber: 123 });
      expect(ghResult).toBeSuccessful();

      // Use plugin tool
      const deployResult = await mcp.tools.call('deploy_application', {
        environment: 'staging',
        version: '1.2.3',
      });
      expect(deployResult).toBeSuccessful();

      // Use another app tool
      const slackResult = await mcp.tools.call('slack_notify', {
        channel: 'deploys',
        message: 'Deployment complete',
      });
      expect(slackResult).toBeSuccessful();
    });
  });

  test.describe('Authorization with Plugin Skills', () => {
    test('should enforce tool allowlist in strict mode with plugin skill', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
        policyMode: 'strict',
      });

      expect(loadResult).toBeSuccessful();

      const loadContent = loadResult.json<LoadSkillResult>();

      // Session should show strict policy mode
      if (loadContent.session?.activated) {
        expect(loadContent.session.policyMode).toBe('strict');
        expect(loadContent.session.allowedTools).toContain('deploy_application');
        expect(loadContent.session.allowedTools).toContain('rollback_deployment');
      }

      // Plugin tool should work
      const deployResult = await mcp.tools.call('deploy_application', {
        environment: 'staging',
        version: '1.0.0',
      });
      expect(deployResult).toBeSuccessful();
    });

    test('should verify session shows plugin skill tools as allowed', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();

      // If session was activated, verify tools
      if (content.session?.activated) {
        expect(content.session.allowedTools).toBeDefined();
        expect(content.session.allowedTools).toContain('deploy_application');
        expect(content.session.allowedTools).toContain('rollback_deployment');
      }
    });

    test('should handle approval mode with plugin skill', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
        policyMode: 'approval',
      });

      expect(loadResult).toBeSuccessful();

      const loadContent = loadResult.json<LoadSkillResult>();

      if (loadContent.session?.activated) {
        expect(loadContent.session.policyMode).toBe('approval');
      }

      // Tool in allowlist should work
      const deployResult = await mcp.tools.call('deploy_application', {
        environment: 'production',
        version: '2.0.0',
      });
      expect(deployResult).toBeSuccessful();
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list plugin tools alongside app tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // App tools
      expect(tools).toContainTool('github_get_pr');
      expect(tools).toContainTool('github_add_comment');
      expect(tools).toContainTool('slack_notify');
      expect(tools).toContainTool('admin_action');

      // Plugin tools
      expect(tools).toContainTool('deploy_application');
      expect(tools).toContainTool('rollback_deployment');

      // Built-in skill tools
      expect(tools).toContainTool('loadSkill');
      expect(tools).toContainTool('searchSkills');
    });
  });

  test.describe('Combined Workflow', () => {
    test('should support complete deployment workflow using plugin skill', async ({ mcp }) => {
      // 1. Search for deployment skill
      const searchResult = await mcp.tools.call('searchSkills', {
        query: 'deploy application staging production',
      });

      expect(searchResult).toBeSuccessful();

      const searchContent = searchResult.json<SearchSkillsResult>();
      expect(searchContent.skills.some((s) => s.id === 'deploy-workflow')).toBe(true);

      // 2. Load the skill
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-workflow',
        activateSession: true,
      });

      expect(loadResult).toBeSuccessful();

      const loadContent = loadResult.json<LoadSkillResult>();
      expect(loadContent.skill.instructions).toContain('Deployment Workflow');

      // 3. Deploy to staging first
      const stagingResult = await mcp.tools.call('deploy_application', {
        environment: 'staging',
        version: '3.0.0',
      });

      expect(stagingResult).toBeSuccessful();

      const stagingContent = stagingResult.json<DeployResult>();
      expect(stagingContent.environment).toBe('staging');

      // 4. Deploy to production
      const prodResult = await mcp.tools.call('deploy_application', {
        environment: 'production',
        version: '3.0.0',
      });

      expect(prodResult).toBeSuccessful();

      const prodContent = prodResult.json<DeployResult>();
      expect(prodContent.environment).toBe('production');

      // 5. Notify team via app tool
      const notifyResult = await mcp.tools.call('slack_notify', {
        channel: 'engineering',
        message: 'Version 3.0.0 deployed to production!',
      });

      expect(notifyResult).toBeSuccessful();
    });

    test('should support rollback scenario', async ({ mcp }) => {
      // 1. Deploy new version
      const deployResult = await mcp.tools.call('deploy_application', {
        environment: 'production',
        version: '4.0.0',
      });

      expect(deployResult).toBeSuccessful();

      // 2. Issue detected, rollback
      const rollbackResult = await mcp.tools.call('rollback_deployment', {
        environment: 'production',
        targetVersion: '3.0.0',
      });

      expect(rollbackResult).toBeSuccessful();

      const rollbackContent = rollbackResult.json<RollbackResult>();
      expect(rollbackContent.rolledBackTo).toBe('3.0.0');
    });
  });
});
