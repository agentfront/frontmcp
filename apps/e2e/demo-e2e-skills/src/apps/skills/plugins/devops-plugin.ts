import { Plugin, Skill, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

// =============================================================================
// Plugin Tools
// =============================================================================

const deployInputSchema = {
  environment: z.enum(['staging', 'production']).describe('Deployment environment'),
  version: z.string().describe('Version to deploy'),
};

const deployOutputSchema = {
  success: z.boolean(),
  environment: z.enum(['staging', 'production']),
  version: z.string(),
  timestamp: z.string(),
};

type DeployInput = z.infer<z.ZodObject<typeof deployInputSchema>>;
type DeployOutput = z.infer<z.ZodObject<typeof deployOutputSchema>>;

@Tool({
  name: 'deploy_application',
  description: 'Deploy application to specified environment',
  inputSchema: deployInputSchema,
  outputSchema: deployOutputSchema,
  tags: ['devops', 'deployment'],
})
class DeployTool extends ToolContext<typeof deployInputSchema, typeof deployOutputSchema, DeployInput, DeployOutput> {
  async execute(input: DeployInput): Promise<DeployOutput> {
    return {
      success: true,
      environment: input.environment,
      version: input.version,
      timestamp: new Date().toISOString(),
    };
  }
}

const rollbackInputSchema = {
  environment: z.enum(['staging', 'production']).describe('Environment to rollback'),
  targetVersion: z.string().optional().describe('Target version to rollback to'),
};

const rollbackOutputSchema = {
  success: z.boolean(),
  environment: z.enum(['staging', 'production']),
  rolledBackTo: z.string(),
};

type RollbackInput = z.infer<z.ZodObject<typeof rollbackInputSchema>>;
type RollbackOutput = z.infer<z.ZodObject<typeof rollbackOutputSchema>>;

@Tool({
  name: 'rollback_deployment',
  description: 'Rollback deployment to previous version',
  inputSchema: rollbackInputSchema,
  outputSchema: rollbackOutputSchema,
  tags: ['devops', 'deployment'],
})
class RollbackTool extends ToolContext<
  typeof rollbackInputSchema,
  typeof rollbackOutputSchema,
  RollbackInput,
  RollbackOutput
> {
  async execute(input: RollbackInput): Promise<RollbackOutput> {
    return {
      success: true,
      environment: input.environment,
      rolledBackTo: input.targetVersion ?? 'previous',
    };
  }
}

// =============================================================================
// Plugin Skills
// =============================================================================

/**
 * Deploy Workflow Skill - teaches AI how to deploy applications
 */
@Skill({
  name: 'deploy-workflow',
  description: 'Complete deployment workflow for applications',
  instructions: `
## Deployment Workflow

1. Use deploy_application tool to deploy the specified version
2. Verify deployment success
3. If issues occur, use rollback_deployment to revert

### Required Information
- Target environment (staging or production)
- Version to deploy

### Safety Notes
- Always deploy to staging first before production
- Have a rollback plan ready
`,
  tools: [
    { name: 'deploy_application', purpose: 'Deploy the application', required: true },
    { name: 'rollback_deployment', purpose: 'Rollback if needed', required: false },
  ],
  tags: ['devops', 'deployment', 'plugin'],
})
class DeployWorkflowSkill {}

/**
 * Hidden Plugin Internal Skill - for testing hidden discovery in plugins
 */
@Skill({
  name: 'plugin-internal-skill',
  description: 'Internal plugin skill for maintenance',
  instructions: 'Internal maintenance instructions',
  hideFromDiscovery: true,
  tags: ['plugin', 'internal'],
})
class PluginInternalSkill {}

// =============================================================================
// Plugin Definition
// =============================================================================

@Plugin({
  name: 'devops-plugin',
  description: 'DevOps tools and skills for deployment workflows',
  tools: [DeployTool, RollbackTool],
  skills: [DeployWorkflowSkill, PluginInternalSkill],
})
export class DevOpsPlugin {}
