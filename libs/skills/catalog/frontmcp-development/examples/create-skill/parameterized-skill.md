---
name: parameterized-skill
reference: create-skill
level: intermediate
description: 'A skill with customizable parameters, usage examples for AI guidance, and controlled visibility.'
tags: [development, skill, parameterized]
features:
  - 'Defining `parameters` to let callers customize skill behavior at invocation time'
  - 'Providing `examples` with `scenario` and `expectedOutcome` to guide AI application'
  - 'Using `tags` for skill categorization and filtering'
  - "Controlling discovery with `visibility: 'mcp'` (MCP-only) vs `visibility: 'both'` (default)"
  - 'Using `hideFromDiscovery: true` to register a skill that is invocable by name but not listed'
---

# Parameterized Skill with Examples and Visibility

A skill with customizable parameters, usage examples for AI guidance, and controlled visibility.

## Code

```typescript
// src/skills/api-design-guide.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'api-design-guide',
  description: 'REST API design guidelines',
  instructions: `# API Design Guide

Design APIs following these conventions.
Adapt the versioning strategy based on the api-style parameter.
Use the auth-required parameter to determine if authentication sections apply.`,
  parameters: [
    { name: 'api-style', description: 'API style to follow', type: 'string', default: 'rest' },
    { name: 'auth-required', description: 'Whether to include auth guidelines', type: 'boolean', default: true },
    { name: 'version-strategy', description: 'API versioning approach', type: 'string', default: 'url-path' },
  ],
  examples: [
    {
      scenario: 'Adding error handling to a new API endpoint',
      expectedOutcome:
        'Endpoint uses specific error classes with MCP error codes, validates input, and returns structured error responses',
    },
    {
      scenario: 'Refactoring try-catch blocks in existing code',
      expectedOutcome: 'Generic catches replaced with specific error types, proper error propagation chain established',
    },
  ],
  tags: ['api', 'design', 'standards'],
  visibility: 'both',
})
class ApiDesignGuideSkill extends SkillContext {}
```

```typescript
// src/skills/internal-runbook.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'internal-runbook',
  description: 'Internal operations runbook',
  instructions: `# Operations Runbook

## Incident Response
1. Check monitoring dashboards
2. Identify affected services
3. Escalate if severity is P0 or P1`,
  visibility: 'mcp', // Only visible to MCP clients, not HTTP discovery
})
class InternalRunbookSkill extends SkillContext {}
```

```typescript
// src/skills/admin-procedures.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'admin-procedures',
  description: 'Administrative procedures for internal use',
  instructions: '...',
  hideFromDiscovery: true, // Registered but hidden from listing endpoints
})
class AdminProceduresSkill extends SkillContext {}
```

## What This Demonstrates

- Defining `parameters` to let callers customize skill behavior at invocation time
- Providing `examples` with `scenario` and `expectedOutcome` to guide AI application
- Using `tags` for skill categorization and filtering
- Controlling discovery with `visibility: 'mcp'` (MCP-only) vs `visibility: 'both'` (default)
- Using `hideFromDiscovery: true` to register a skill that is invocable by name but not listed

## Related

- See `create-skill` for the full parameters, examples, and visibility reference
