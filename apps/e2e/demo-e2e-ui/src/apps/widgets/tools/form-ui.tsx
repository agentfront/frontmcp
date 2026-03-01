/**
 * Form UI Component with Hooks
 *
 * Example demonstrating dynamic form generation using @frontmcp/ui hooks.
 */

import React, { useState } from 'react';
import { Card, Badge, Button } from '@frontmcp/ui/components';
import {
  McpBridgeProvider,
  useToolInput,
  useToolOutput,
  useTheme,
  useMcpBridgeContext,
  useSendMessage,
} from '@frontmcp/ui/react';

// Type definitions
interface FormField {
  name: string;
  type: 'text' | 'email' | 'number' | 'textarea';
  label: string;
  required?: boolean;
}

interface FormInput {
  fields: FormField[];
  submitLabel?: string;
}

interface FormOutput {
  fields: FormField[];
  fieldCount: number;
}

/**
 * Props for FormCardWithHooks
 */
interface FormCardWithHooksProps {
  input?: FormInput;
  output?: FormOutput;
  structuredContent?: FormOutput;
}

/**
 * FormField Component - Renders a single form field
 */
function FormFieldInput({
  field,
  value,
  onChange,
  theme,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
}) {
  const inputClasses = `w-full px-3 py-2 rounded-md border transition-colors
    ${
      theme === 'dark'
        ? 'bg-bg-secondary border-divider text-text-primary focus:border-accent'
        : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
    }
    focus:outline-none focus:ring-2 focus:ring-opacity-50
    ${theme === 'dark' ? 'focus:ring-accent' : 'focus:ring-blue-500'}`;

  if (field.type === 'textarea') {
    return (
      <textarea
        name={field.name}
        required={field.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClasses} min-h-[80px] resize-y`}
        placeholder={`Enter ${field.label.toLowerCase()}...`}
      />
    );
  }

  return (
    <input
      type={field.type}
      name={field.name}
      required={field.required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClasses}
      placeholder={`Enter ${field.label.toLowerCase()}...`}
    />
  );
}

/**
 * FormCardWithHooks - Dynamic form using hooks
 *
 * This component uses hooks to access:
 * - Tool input (form field configuration)
 * - Tool output (processed form data)
 * - Theme (light/dark mode)
 * - Send message capability
 */
export function FormCardWithHooks({
  input: ssrInput,
  output: ssrOutput,
  structuredContent,
}: FormCardWithHooksProps = {}) {
  const { ready } = useMcpBridgeContext();
  const hookOutput = useToolOutput<FormOutput>();
  const output = structuredContent ?? ssrOutput ?? hookOutput;

  const hookInput = useToolInput<FormInput>();
  const input = ssrInput ?? hookInput;

  const theme = useTheme();
  const [sendMessage] = useSendMessage();
  const cardElevation = theme === 'dark' ? 3 : 1;

  // Form state
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const submitLabel = input?.submitLabel || 'Submit';
  const fields = output?.fields || [];

  // No data state
  if (!output || fields.length === 0) {
    return (
      <Card title="Dynamic Form" elevation={cardElevation}>
        <div className="text-center py-6">
          <div className="text-5xl font-light text-text-primary mb-3">--</div>
          <p className="text-sm text-text-secondary">No form fields configured</p>
        </div>
      </Card>
    );
  }

  const handleFieldChange = (name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    // Send form data as a follow-up message if available
    if (sendMessage) {
      sendMessage(`Form submitted with values: ${JSON.stringify(formValues, null, 2)}`);
    }
  };

  const requiredCount = fields.filter((f) => f.required).length;

  return (
    <Card
      title="Dynamic Form"
      subtitle={`${fields.length} fields (${requiredCount} required)`}
      elevation={cardElevation}
      footer={
        <div className="flex justify-between items-center">
          <p className="text-xs text-text-secondary">Using @frontmcp/ui hooks</p>
          {submitted && <Badge variant="success" size="small" label="Submitted" />}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 py-2">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <label className="block text-sm font-medium text-text-primary">
              {field.label}
              {field.required && <span className="text-danger ml-1">*</span>}
            </label>
            <FormFieldInput
              field={field}
              value={formValues[field.name] || ''}
              onChange={(value) => handleFieldChange(field.name, value)}
              theme={theme}
            />
          </div>
        ))}

        <div className="pt-4">
          <Button type="submit" variant="primary" fullWidth disabled={submitted}>
            {submitted ? 'Submitted!' : submitLabel}
          </Button>
        </div>
      </form>

      {/* Debug info (only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 pt-4 border-t border-divider">
          <details className="text-xs text-text-secondary">
            <summary className="cursor-pointer hover:text-text-primary">Debug Info</summary>
            <pre className="mt-2 p-2 bg-bg-secondary rounded text-left overflow-x-auto">
              {JSON.stringify({ input, output, formValues, theme, ready }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}

/**
 * FormApp - Wrapped component with McpBridgeProvider
 */
export function FormApp() {
  return (
    <McpBridgeProvider config={{ debug: true }}>
      <FormCardWithHooks />
    </McpBridgeProvider>
  );
}

export default FormCardWithHooks;
