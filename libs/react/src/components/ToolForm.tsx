/**
 * ToolForm — headless form generator from tool.inputSchema.
 *
 * If `renderField` is provided, delegates rendering to the consumer.
 * Otherwise uses basic unstyled `<input>` / `<select>` / `<textarea>`.
 */

import React, { useState, useCallback } from 'react';
import type { ToolInfo, FieldRenderProps } from '../types';

export interface ToolFormProps {
  tool: ToolInfo;
  onSubmit: (args: Record<string, unknown>) => void;
  renderField?: (props: FieldRenderProps) => React.ReactNode;
  submitLabel?: string;
}

export function ToolForm({
  tool,
  onSubmit,
  renderField,
  submitLabel = 'Call Tool',
}: ToolFormProps): React.ReactElement {
  const schema = tool.inputSchema ?? {};
  const properties = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema['required'] ?? []) as string[];
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const args: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const raw = values[key] ?? '';
        if (!required.includes(key) && raw === '') continue;
        if (prop['type'] === 'number' || prop['type'] === 'integer') {
          args[key] = Number(raw);
        } else if (prop['type'] === 'boolean') {
          args[key] = raw === 'true';
        } else {
          args[key] = raw;
        }
      }
      onSubmit(args);
    },
    [values, properties, onSubmit],
  );

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return React.createElement(
    'form',
    { onSubmit: handleSubmit },
    ...Object.entries(properties).map(([key, prop]) => {
      const isRequired = required.includes(key);
      const enumValues = prop['enum'] as string[] | undefined;
      const fieldType = getFieldType(prop);
      const value = values[key] ?? '';

      if (renderField) {
        return React.createElement(
          React.Fragment,
          { key },
          renderField({
            name: key,
            type: fieldType,
            required: isRequired,
            description: prop['description'] as string | undefined,
            enumValues,
            value,
            onChange: (v: string) => handleChange(key, v),
          }),
        );
      }

      return React.createElement(
        'div',
        { key, style: { marginBottom: '8px' } },
        React.createElement(
          'label',
          { htmlFor: `field-${key}`, style: { display: 'block', marginBottom: '4px' } },
          `${key}${isRequired ? ' *' : ''}`,
        ),
        enumValues
          ? React.createElement(
              'select',
              {
                id: `field-${key}`,
                value: value || enumValues[0] || '',
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleChange(key, e.target.value),
              },
              ...enumValues.map((v) => React.createElement('option', { key: v, value: v }, v)),
            )
          : React.createElement('input', {
              id: `field-${key}`,
              type: fieldType === 'number' || fieldType === 'integer' ? 'number' : 'text',
              step: fieldType === 'integer' ? '1' : undefined,
              placeholder: (prop['description'] as string) ?? '',
              required: isRequired,
              value,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleChange(key, e.target.value),
            }),
      );
    }),
    React.createElement('button', { type: 'submit' }, submitLabel),
  );
}

function getFieldType(prop: Record<string, unknown>): string {
  if (prop['enum']) return 'enum';
  return (prop['type'] as string) ?? 'string';
}
