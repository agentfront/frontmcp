import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    fields: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(['text', 'email', 'number', 'textarea']),
          label: z.string(),
          required: z.boolean().optional(),
        }),
      )
      .describe('Form fields configuration'),
    submitLabel: z.string().optional().describe('Submit button text'),
  })
  .strict();

const outputSchema = z.object({
  uiType: z.literal('react'),
  fields: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['text', 'email', 'number', 'textarea']),
      label: z.string(),
      required: z.boolean().optional(),
    }),
  ),
  fieldCount: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'react-form',
  description: 'Generate a React form component',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'react',
    template: (ctx) => {
      const { fields } = ctx.output as unknown as Output;
      const submitLabel = (ctx.input as unknown as Input).submitLabel || 'Submit';

      return `
        function DynamicForm() {
          const fields = ${JSON.stringify(fields)};
          const submitLabel = ${JSON.stringify(submitLabel)};

          return (
            <form style={{ fontFamily: 'sans-serif', maxWidth: '400px', padding: '16px' }}>
              {fields.map((field, i) => (
                <div key={i} style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                    {field.label}{field.required && <span style={{ color: 'red' }}>*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      name={field.name}
                      required={field.required}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', minHeight: '80px' }}
                    />
                  ) : (
                    <input
                      type={field.type}
                      name={field.name}
                      required={field.required}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                  )}
                </div>
              ))}
              <button
                type="submit"
                style={{
                  background: '#4A90D9',
                  color: 'white',
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {submitLabel}
              </button>
            </form>
          );
        }
      `;
    },
  },
})
export default class ReactFormTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'react',
      fields: input.fields,
      fieldCount: input.fields.length,
    };
  }
}
