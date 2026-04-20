---
name: directory-skill-with-tools
reference: create-skill-with-tools
level: advanced
description: 'A directory-based skill loaded with `skillDir()`, plus a class-based skill using Agent Skills spec metadata fields.'
tags: [development, skill, tools, directory]
features:
  - 'Loading a directory-based skill with `skillDir()` including SKILL.md frontmatter with tool entries'
  - 'Mixing all three tool reference styles in one `tools` array: class, string, and object'
  - 'Agent Skills spec fields: `priority`, `license`, `compatibility`, `allowedTools`, `specMetadata`'
  - 'Bundled resource directories: `scripts`, `references`, `assets`'
  - "File-based instructions with `{ file: './docs/codebase-audit.md' }`"
---

# Directory-Based Skill with Tools, Agent Skills Spec Fields, and Registration

A directory-based skill loaded with `skillDir()`, plus a class-based skill using Agent Skills spec metadata fields.

## Code

```text
skills/
  deploy-service/
    SKILL.md           # Instructions with YAML frontmatter
    scripts/
      validate.sh      # Helper scripts
      smoke-test.sh
    references/
      architecture.md  # Reference documentation
      runbook.md
    assets/
      topology.png     # Visual assets
```

```markdown
## <!-- skills/deploy-service/SKILL.md -->

name: deploy-service
description: Deploy a service through the full pipeline
tags: [deploy, ci-cd, production]
tools:

- name: build_project
  purpose: Compile the service
  required: true
- name: run_tests
  purpose: Execute test suite
  required: true
- name: deploy_to_env
  purpose: Push build to target environment
  required: true
  parameters:
- name: environment
  description: Target deployment environment
  type: string
  required: true
  examples:
- scenario: Deploy to staging
  expected-outcome: Service deployed and health check passes

---

# Deploy Service

Follow these steps to deploy the service...
```

```typescript
// src/skills/load-skills.ts
import { skillDir } from '@frontmcp/sdk';

const DeployServiceSkill = await skillDir('./skills/deploy-service');
```

```typescript
// src/skills/audit.skill.ts
import { Skill, SkillContext, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'analyze_codebase',
  description: 'Analyze a codebase for patterns and issues',
  inputSchema: {
    path: z.string().describe('Path to the codebase'),
    checks: z.array(z.string()).describe('Checks to run'),
  },
})
class AnalyzeCodebaseTool extends ToolContext {
  async execute(input: { path: string; checks: string[] }) {
    return { issues: [], score: 95 };
  }
}

@Skill({
  name: 'codebase-audit',
  description: 'Perform a comprehensive codebase audit with reporting and issue creation',
  instructions: { file: './docs/codebase-audit.md' },
  tools: [
    AnalyzeCodebaseTool,
    'generate_report',
    { name: 'create_issue', purpose: 'File GitHub issues for critical findings', required: false },
  ],
  toolValidation: 'strict',
  priority: 10,
  license: 'MIT',
  compatibility: 'Node.js 24+',
  allowedTools: 'Read Edit Bash(git status)',
  specMetadata: {
    author: 'platform-team',
    version: '2.0.0',
  },
  resources: {
    scripts: './scripts',
    references: './references',
    assets: './assets',
  },
})
class CodebaseAuditSkill extends SkillContext {}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({
  name: 'audit-app',
  skills: [DeployServiceSkill, CodebaseAuditSkill],
  tools: [AnalyzeCodebaseTool, GenerateReportTool, CreateIssueTool],
})
class AuditApp {}

@FrontMcp({
  info: { name: 'audit-server', version: '1.0.0' },
  apps: [AuditApp],
})
class AuditServer {}
```

## What This Demonstrates

- Loading a directory-based skill with `skillDir()` including SKILL.md frontmatter with tool entries
- Mixing all three tool reference styles in one `tools` array: class, string, and object
- Agent Skills spec fields: `priority`, `license`, `compatibility`, `allowedTools`, `specMetadata`
- Bundled resource directories: `scripts`, `references`, `assets`
- File-based instructions with `{ file: './docs/codebase-audit.md' }`

## Related

- See `create-skill-with-tools` for the full Agent Skills spec fields reference and CodeCall compatibility
