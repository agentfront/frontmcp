import { Tool, ToolContext, InvalidInputError } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    value: z.string().describe('Value to validate'),
    minLength: z.number().optional().default(5).describe('Minimum length required'),
  })
  .strict();

const outputSchema = z.object({
  valid: z.boolean(),
  value: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'throw-validation-error',
  description: 'Throws an InvalidInputError if validation fails',
  inputSchema,
  outputSchema,
})
export default class ThrowValidationErrorTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    if (input.value.length < input.minLength) {
      throw new InvalidInputError(`Value must be at least ${input.minLength} characters`, {
        field: 'value',
        actual: input.value.length,
        required: input.minLength,
      });
    }

    return {
      valid: true,
      value: input.value,
    };
  }
}
