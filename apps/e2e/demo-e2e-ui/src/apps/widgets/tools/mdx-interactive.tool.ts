import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    topic: z.string().describe('Interactive topic'),
    points: z.array(z.string()).describe('Key points to display'),
    codeExample: z.string().optional().describe('Optional code example'),
  })
  .strict();

const outputSchema = z.object({
  uiType: z.literal('mdx'),
  topic: z.string(),
  points: z.array(z.string()),
  hasCode: z.boolean(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'mdx-interactive',
  description: 'Generate an interactive MDX component',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'mdx',
    template: (ctx) => {
      const { topic, points, hasCode } = ctx.output as unknown as Output;
      const codeExample = (ctx.input as unknown as Input).codeExample;

      const pointsList = points.map((p) => `- ${p}`).join('\n');

      return `
# ${topic}

<Callout type="info">
  This is an interactive MDX document with ${points.length} key points.
</Callout>

## Key Points

${pointsList}

${
  hasCode
    ? `
## Code Example

\`\`\`typescript
${codeExample}
\`\`\`
`
    : ''
}

<Button onClick={() => console.log('Clicked!')}>
  Learn More
</Button>
      `;
    },
  },
})
export default class MdxInteractiveTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'mdx',
      topic: input.topic,
      points: input.points,
      hasCode: !!input.codeExample,
    };
  }
}
