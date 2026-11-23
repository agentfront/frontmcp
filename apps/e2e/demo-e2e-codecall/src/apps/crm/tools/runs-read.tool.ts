import { z } from '@frontmcp/lazy-zod';
import { CodeCallRunStoreToken } from '@frontmcp/plugins';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  runId: z.string().describe('The run id a codecall:execute result returned'),
};

@Tool({
  name: 'runs-read',
  description: "Read a CodeCall run record, as its owner: the caller's session and subject",
  inputSchema,
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
export default class RunsReadTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>) {
    const record = await this.get(CodeCallRunStoreToken).read(input.runId, this);
    return { record: record ?? null };
  }
}
