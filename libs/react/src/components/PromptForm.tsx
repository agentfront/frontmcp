/**
 * PromptForm — headless form generator from prompt.arguments.
 */

import React, { useState, useCallback } from 'react';
import type { PromptInfo, FieldRenderProps } from '../types';

export interface PromptFormProps {
  prompt: PromptInfo;
  onSubmit: (args: Record<string, string>) => void;
  renderField?: (props: FieldRenderProps) => React.ReactNode;
  submitLabel?: string;
}

export function PromptForm({
  prompt,
  onSubmit,
  renderField,
  submitLabel = 'Get Prompt',
}: PromptFormProps): React.ReactElement {
  const args = prompt.arguments ?? [];
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const result: Record<string, string> = {};
      for (const arg of args) {
        result[arg.name] = values[arg.name] ?? '';
      }
      onSubmit(result);
    },
    [values, args, onSubmit],
  );

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return React.createElement(
    'form',
    { onSubmit: handleSubmit },
    ...args.map((arg) => {
      const value = values[arg.name] ?? '';

      if (renderField) {
        return renderField({
          name: arg.name,
          type: 'string',
          required: arg.required ?? false,
          description: arg.description,
          value,
          onChange: (v: string) => handleChange(arg.name, v),
        });
      }

      return React.createElement(
        'div',
        { key: arg.name, style: { marginBottom: '8px' } },
        React.createElement(
          'label',
          { htmlFor: `prompt-${arg.name}`, style: { display: 'block', marginBottom: '4px' } },
          `${arg.name}${arg.required ? ' *' : ''}`,
        ),
        React.createElement('textarea', {
          id: `prompt-${arg.name}`,
          placeholder: arg.description ?? '',
          required: arg.required,
          value,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange(arg.name, e.target.value),
          rows: 3,
          style: { width: '100%' },
        }),
      );
    }),
    React.createElement('button', { type: 'submit' }, submitLabel),
  );
}
