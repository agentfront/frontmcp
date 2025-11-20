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
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  description: `Get detailed schemas and usage examples for specific tools discovered through search.

WHEN TO USE:
- After using codecall:search to find relevant tools
- Before writing a code-call:execute script that uses those tools
- When you need to understand the exact input/output structure of a tool

WHAT YOU GET:
- Input schema: What parameters the tool accepts
- Output schema: What data structure the tool returns
- Usage example: Ready-to-use JavaScript code showing how to call the tool with callTool()
- App context: Which app the tool belongs to

WORKFLOW:
1. codecall:search → Discover tool names
2. codecall:describe → Get schemas and examples for those tools
3. codecall:execute → Write and run JavaScript that calls the tools

IMPORTANT:
- Only request tools you found via codecall:search
- The usage examples show the exact callTool() syntax you'll use in codecall:execute
- If a tool is not found, check the notFound array for typos in tool names

EXAMPLE:
After searching and finding "users:list", describe it to see:
- What input parameters it needs (e.g., { limit: number, offset: number })
- What output it returns (e.g., { items: User[], total: number })
- How to call it: const users = await callTool('users:list', { limit: 10 });`,
  inputSchema: describeToolInputSchema,
  outputSchema: describeToolOutputSchema,
})
export default class DescribeTool extends ToolContext {
  async execute(input: DescribeToolInput): Promise<DescribeToolOutput> {
    const { toolNames } = input;

    // TODO: Implement actual tool description logic
    // This should:
    // 1. Access the CodeCall plugin's tool index
    // 2. For each toolName, fetch:
    //    - Tool metadata (name, appId, description)
    //    - Input schema (JSON Schema format)
    //    - Output schema (JSON Schema format)
    //    - Annotations (MCP metadata)
    // 3. Generate a usage example showing how to call the tool
    // 4. Detect tools that don't exist and add them to notFound

    const tools: DescribeToolOutput['tools'] = [];
    const notFound: string[] = [];

    // Placeholder: Check which tools exist
    for (const toolName of toolNames) {
      // TODO: Check if tool exists in index
      const toolExists = false; // Placeholder

      if (!toolExists) {
        notFound.push(toolName);
        continue;
      }

      // TODO: Fetch actual tool definition
      // Example structure:
      // tools.push({
      //   name: toolName,
      //   appId: 'user', // from tool index
      //   description: 'List users with pagination', // from tool definition
      //   inputSchema: { /* JSON Schema */ },
      //   outputSchema: { /* JSON Schema */ },
      //   annotations: { /* MCP annotations */ },
      //   usageExample: {
      //     description: 'Fetch first 10 users',
      //     code: `const result = await callTool('${toolName}', { limit: 10, offset: 0 });`,
      //   },
      // });
    }

    return {
      tools,
      notFound: notFound.length > 0 ? notFound : undefined,
    };
  }
}
