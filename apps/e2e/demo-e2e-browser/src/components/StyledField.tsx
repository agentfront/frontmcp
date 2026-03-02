import React from 'react';
import type { FieldRenderProps } from '@frontmcp/react';

export function StyledField({
  name,
  type,
  required,
  description,
  enumValues,
  value,
  onChange,
}: FieldRenderProps): React.ReactElement {
  const fieldId = `field-${name}`;
  return (
    <div className="form-group" key={name}>
      <label htmlFor={fieldId}>
        {name}
        {required ? ' *' : ''} {type !== 'string' && <span className="field-type">{type}</span>}
      </label>
      {enumValues ? (
        <select id={fieldId} value={value ?? enumValues[0] ?? ''} onChange={(e) => onChange(e.target.value)}>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : type === 'number' || type === 'integer' ? (
        <input
          id={fieldId}
          type="number"
          step={type === 'integer' ? '1' : 'any'}
          placeholder={description ?? ''}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : name === 'text' || name === 'code' || name === 'content' ? (
        <textarea
          id={fieldId}
          placeholder={description ?? ''}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          placeholder={description ?? ''}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
