import { Skill } from '@frontmcp/sdk';

@Skill({
  name: 'math-helper',
  description: 'A helper skill for math operations',
  instructions: `
## Math Helper

Use the add tool to perform addition operations.

### Steps
1. Use the add tool with the provided numbers
2. Return the result
`,
  tools: [{ name: 'add', purpose: 'Add two numbers' }],
  tags: ['math', 'helper'],
})
export class MathHelperSkill {}
