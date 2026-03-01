import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { buildShell } from '@frontmcp/uipack';

const inputSchema = {
  content: z.string().describe('HTML content to wrap in the shell'),
  toolName: z.string().describe('Tool name for data injection'),
  withShell: z.boolean().optional().default(true).describe('Whether to wrap in full HTML document'),
  includeBridge: z.boolean().optional().default(true).describe('Include bridge runtime'),
  title: z.string().optional().describe('Page title'),
  cspResourceDomains: z.array(z.string()).optional().describe('Additional CSP resource domains'),
  input: z.unknown().optional().describe('Tool input data to inject'),
  output: z.unknown().optional().describe('Tool output data to inject'),
};

const outputSchema = z.object({
  html: z.string(),
  hash: z.string(),
  size: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'build-shell',
  description: 'Build an HTML shell with CSP, data injection, and optional bridge runtime',
  inputSchema,
  outputSchema,
})
export default class BuildShellTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const result = buildShell(input.content, {
      toolName: input.toolName,
      withShell: input.withShell,
      includeBridge: input.includeBridge,
      title: input.title,
      csp: input.cspResourceDomains ? { resourceDomains: input.cspResourceDomains } : undefined,
      input: input.input,
      output: input.output,
    });

    return {
      html: result.html,
      hash: result.hash,
      size: result.size,
    };
  }
}
