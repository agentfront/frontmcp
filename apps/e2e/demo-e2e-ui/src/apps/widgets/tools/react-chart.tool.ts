import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    data: z
      .array(
        z.object({
          label: z.string(),
          value: z.number(),
        }),
      )
      .describe('Chart data points'),
    title: z.string().optional().describe('Chart title'),
  })
  .strict();

const outputSchema = z.object({
  uiType: z.literal('react'),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
  maxValue: z.number(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'react-chart',
  description: 'Generate a React bar chart visualization',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'react',
    template: (ctx) => {
      const { data, maxValue } = ctx.output as unknown as Output;
      const title = (ctx.input as unknown as Input).title;

      return `
        function BarChart() {
          const data = ${JSON.stringify(data)};
          const maxValue = ${maxValue};
          const title = ${JSON.stringify(title || 'Chart')};

          return (
            <div style={{ fontFamily: 'sans-serif', padding: '16px' }}>
              <h3 style={{ margin: '0 0 16px 0' }}>{title}</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', height: '200px', gap: '8px' }}>
                {data.map((item, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div
                      style={{
                        height: \`\${(item.value / maxValue) * 180}px\`,
                        background: '#4A90D9',
                        borderRadius: '4px 4px 0 0',
                        minHeight: '4px',
                      }}
                    />
                    <div style={{ fontSize: '12px', marginTop: '8px' }}>{item.label}</div>
                    <div style={{ fontSize: '10px', color: '#666' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }
      `;
    },
  },
})
export default class ReactChartTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const maxValue = Math.max(...input.data.map((d) => d.value), 1);

    return {
      uiType: 'react',
      data: input.data,
      maxValue,
    };
  }
}
