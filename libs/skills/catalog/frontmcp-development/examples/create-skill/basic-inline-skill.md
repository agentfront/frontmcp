---
name: basic-inline-skill
reference: create-skill
level: basic
description: 'A minimal instruction-only skill with inline content and the function builder alternative.'
tags: [development, skill, inline]
features:
  - 'Creating a class-based instruction-only skill with `@Skill` and `SkillContext`'
  - 'Using inline string instructions for short, self-contained guides'
  - 'The `skill()` function builder as a lighter alternative when no `build()` override is needed'
  - 'Setting `visibility` to control where the skill is discoverable'
---

# Basic Inline Instruction Skill

A minimal instruction-only skill with inline content and the function builder alternative.

## Code

```typescript
// src/skills/typescript-conventions.skill.ts
import { Skill, SkillContext } from '@frontmcp/sdk';

@Skill({
  name: 'typescript-conventions',
  description: 'TypeScript coding conventions and patterns for the project',
  instructions: `# TypeScript Conventions

## Naming
- Use PascalCase for classes and interfaces
- Use camelCase for variables, functions, and methods
- Use UPPER_SNAKE_CASE for constants
- Use kebab-case for file names

## Types
- Always use explicit return types on public methods
- Prefer \`unknown\` over \`any\` for generic defaults
- Use strict mode (\`strict: true\` in tsconfig)
- Define shared types in a common directory

## Error Handling
- Use specific error classes, not raw Error
- Never use non-null assertions (\`!\`) -- throw proper errors
- Use \`this.fail(err)\` in execution contexts

## Imports
- Use barrel exports (index.ts) for public APIs
- No circular dependencies
- Group imports: external, internal, relative`,
})
class TypeScriptConventionsSkill extends SkillContext {}
```

```typescript
// src/skills/code-review-checklist.skill.ts
import { skill } from '@frontmcp/sdk';

// Function-style skill -- no class needed for simple instruction-only skills
const CodeReviewChecklist = skill({
  name: 'code-review-checklist',
  description: 'Checklist for reviewing pull requests',
  instructions: `# Code Review Checklist

## Correctness
- Does the code do what it claims?
- Are edge cases handled?
- Are error paths covered?

## Style
- Does it follow project conventions?
- Are names descriptive and consistent?
- Is the code self-documenting?

## Testing
- Are there tests for new functionality?
- Do tests cover edge cases?
- Is coverage above 95%?

## Security
- No secrets in code or config?
- Input validation present?
- Proper error handling without leaking internals?`,
  visibility: 'both',
});
```

## What This Demonstrates

- Creating a class-based instruction-only skill with `@Skill` and `SkillContext`
- Using inline string instructions for short, self-contained guides
- The `skill()` function builder as a lighter alternative when no `build()` override is needed
- Setting `visibility` to control where the skill is discoverable

## Related

- See `create-skill` for file-based instructions, parameters, and directory-based skills
