---
name: directory-based-skill
reference: create-skill
level: advanced
description: 'A skill loaded from a directory structure with SKILL.md frontmatter, plus file-based and URL-based instruction sources.'
tags: [development, remote, skill, directory, based]
features:
  - 'Loading a skill from a directory with `skillDir()` including SKILL.md frontmatter and bundled resources'
  - 'The SKILL.md YAML frontmatter format for metadata (name, description, tags, parameters, examples)'
  - "File-based instructions with `{ file: './path.md' }` resolved relative to the skill file"
  - "URL-based instructions with `{ url: '...' }` fetched at build time"
  - 'ESM loading with `Skill.esm()` and remote loading with `Skill.remote()`'
---

# Directory-Based Skill with File References and Registration

A skill loaded from a directory structure with SKILL.md frontmatter, plus file-based and URL-based instruction sources.

## Code

```text
skills/
  coding-standards/
    SKILL.md           # Instructions with YAML frontmatter
    scripts/
      lint-check.sh    # Helper scripts referenced in instructions
    references/
      patterns.md      # Reference documentation appended to context
    assets/
      diagram.png      # Visual assets
```

```markdown
## <!-- skills/coding-standards/SKILL.md -->

name: coding-standards
description: Project coding standards and patterns
tags: [standards, conventions, quality]
parameters:

- name: language
  description: Target programming language
  type: string
  default: typescript
  examples:
- scenario: Apply coding standards to a new module
  expected-outcome: Code follows all project conventions

---

# Coding Standards

Follow these standards when writing code for this project...
```

```typescript
// src/skills/load-skills.ts
import { skillDir, skill } from '@frontmcp/sdk';

// Load a directory-based skill with bundled scripts, references, and assets
const CodingStandards = await skillDir('./skills/coding-standards');

// File-based instructions -- path resolves relative to this file's directory
const DeployGuide = skill({
  name: 'deploy-guide',
  description: 'Step-by-step deployment checklist',
  instructions: { file: './docs/deploy-guide.md' }, // resolves to src/skills/docs/deploy-guide.md
});
```

```typescript
// src/server.ts
import { FrontMcp, App, Skill, SkillContext } from '@frontmcp/sdk';

// URL-based instructions fetched at build time
@Skill({
  name: 'api-standards',
  description: 'REST API design standards',
  instructions: { url: 'https://docs.example.com/standards/api-design.md' },
})
class ApiStandardsSkill extends SkillContext {}

// ESM and remote loading
const ExternalGuide = Skill.esm('@my-org/skills@^1.0.0', 'ExternalGuide', {
  description: 'A skill loaded from an ES module',
});

const CloudGuide = Skill.remote('https://example.com/skills/style-guide', 'CloudGuide', {
  description: 'A skill loaded from a remote server',
});

@App({
  name: 'standards-app',
  skills: [CodingStandards, DeployGuide, ApiStandardsSkill, ExternalGuide, CloudGuide],
})
class StandardsApp {}

@FrontMcp({
  info: { name: 'dev-server', version: '1.0.0' },
  apps: [StandardsApp],
})
class DevServer {}
```

## What This Demonstrates

- Loading a skill from a directory with `skillDir()` including SKILL.md frontmatter and bundled resources
- The SKILL.md YAML frontmatter format for metadata (name, description, tags, parameters, examples)
- File-based instructions with `{ file: './path.md' }` resolved relative to the skill file
- URL-based instructions with `{ url: '...' }` fetched at build time
- ESM loading with `Skill.esm()` and remote loading with `Skill.remote()`

## Related

- See `create-skill` for the complete `skillDir()` reference, instruction resolution, and HTTP discovery
