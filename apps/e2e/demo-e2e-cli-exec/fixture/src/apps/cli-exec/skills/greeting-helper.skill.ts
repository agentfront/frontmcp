import { skill } from '@frontmcp/sdk';

export default skill({
  name: 'greeting-helper',
  description: 'A helper skill for greeting users',
  instructions: { file: './docs/greeting-guide.md' },
  tools: [{ name: 'greet', purpose: 'Greet a user by name' }],
  tags: ['greeting', 'helper'],
});
