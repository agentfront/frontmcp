/**
 * React Form Tool with React UI
 *
 * Demonstrates how to use React components for Tool UI templates.
 * The UI is defined as a React component and rendered via the React renderer.
 */

import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import FormCard from './form-ui';

// Define input/output schemas
const inputSchema = {
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
};

const outputSchema = z.object({
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

// Infer types from schemas
type FormInput = z.infer<z.ZodObject<typeof inputSchema>>;
type FormOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'react-form',
  description: 'Generate a dynamic React form component. Returns interactive form with configurable fields.',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Dynamic Form',
    readOnlyHint: false,
    openWorldHint: true,
  },
  ui: {
    template: FormCard,
    widgetDescription: 'Displays a dynamic form with configurable fields and validation.',
    displayMode: 'inline',
    widgetAccessible: true,
    servingMode: 'auto',
    resourceMode: 'cdn',
  },
})
export default class ReactFormTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: FormInput): Promise<FormOutput> {
    return {
      fields: input.fields,
      fieldCount: input.fields.length,
    };
  }
}
