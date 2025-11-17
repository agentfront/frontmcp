// file: libs/plugins/src/codecall/tools/describe.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import {
  DescribeToolInput,
  describeToolInputSchema,
  DescribeToolOutput,
  describeToolOutputSchema,
} from './describe.schema';

@Tool({
  name: 'codecall:describe',
  description:
    'Describe CodeCall tools by their names to get details like description, input/output schema, and annotations',
  inputSchema: describeToolInputSchema,
  outputSchema: describeToolOutputSchema,
})
export default class CodeCallDescribeTool extends ToolContext {
  async execute(input: DescribeToolInput): Promise<DescribeToolOutput> {
    return {} as any;
  }
}
