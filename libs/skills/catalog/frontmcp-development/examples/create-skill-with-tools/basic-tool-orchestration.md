---
name: basic-tool-orchestration
reference: create-skill-with-tools
level: basic
description: 'A skill that guides an AI client through a deploy workflow using referenced MCP tools.'
tags: [development, skill, tools, tool, orchestration]
features:
  - "Referencing tools by class (`BuildProjectTool`) and by string name (`'health_check'`)"
  - 'Mixing class references and string names in a single `tools` array'
  - 'Writing step-by-step instructions that guide the AI to use specific tools'
  - 'The `skill()` function builder for tool-referencing skills that need no class'
---

# Basic Skill with Tool References

A skill that guides an AI client through a deploy workflow using referenced MCP tools.

## Code

```typescript
// src/skills/deploy-service.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';
import { BuildProjectTool } from '../tools/build-project.tool';
import { RunTestsTool } from '../tools/run-tests.tool';
import { DeployToEnvTool } from '../tools/deploy-to-env.tool';

@Skill({
  name: 'deploy-service',
  description: 'Deploy a service through the build, test, and release pipeline',
  instructions: `# Deploy Service Workflow

## Step 1: Build
Use the \`build_project\` tool to compile the service.
Pass the service name and target environment.

## Step 2: Run Tests
Use the \`run_tests\` tool to execute the test suite.
If tests fail, stop and report the failures.

## Step 3: Deploy
Use the \`deploy_to_env\` tool to push the build to the target environment.
Verify the deployment using \`health_check\` tool.

## Step 4: Notify
Use the \`send_notification\` tool to notify the team of the deployment status.`,
  tools: [BuildProjectTool, RunTestsTool, DeployToEnvTool, 'health_check', 'send_notification'],
})
class DeployServiceSkill extends SkillContext {}
```

```typescript
// src/skills/quick-deploy.skill.ts
import { skill } from '@frontmcp/sdk';

// Function-style skill with tool references
const QuickDeploySkill = skill({
  name: 'quick-deploy',
  description: 'Quick deployment to staging',
  instructions: `# Quick Deploy
1. Use build_project to compile.
2. Use deploy_to_env with environment=staging.
3. Use health_check to verify.`,
  tools: ['build_project', 'deploy_to_env', 'health_check'],
});
```

## What This Demonstrates

- Referencing tools by class (`BuildProjectTool`) and by string name (`'health_check'`)
- Mixing class references and string names in a single `tools` array
- Writing step-by-step instructions that guide the AI to use specific tools
- The `skill()` function builder for tool-referencing skills that need no class

## Related

- See `create-skill-with-tools` for all three tool reference styles and validation modes
