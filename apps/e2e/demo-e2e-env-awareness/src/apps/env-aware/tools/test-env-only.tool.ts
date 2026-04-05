import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to NODE_ENV=test.
 * Jest sets NODE_ENV=test, so this should be visible in default e2e runs.
 */
@Tool({
  name: 'test_env_only_tool',
  description: 'Tool only available when NODE_ENV=test',
  inputSchema,
  availableWhen: { env: ['test'] },
})
export default class TestEnvOnlyTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `test-env: ${input.msg}`;
  }
}
