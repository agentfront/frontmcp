import { Skill } from '@frontmcp/sdk';
import { resolve, dirname } from 'path';

const skillDir = resolve(dirname(__filename), 'docs-skill');

/**
 * Docs Skill - fixture skill with references and examples for E2E testing.
 */
@Skill({
  name: 'docs-skill',
  description: 'A fixture skill with references and examples for E2E testing',
  instructions: { file: resolve(skillDir, 'SKILL.md') },
  tags: ['docs', 'testing', 'fixture'],
  resources: {
    references: resolve(skillDir, 'references'),
    examples: resolve(skillDir, 'examples'),
  },
})
export class DocsSkill {}
