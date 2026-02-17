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
  return (
    <div className="form-group" key={name}>
      <label>
        {name}
        {required ? ' *' : ''} {type !== 'string' && <span className="field-type">{type}</span>}
      </label>
      {enumValues ? (
        <select value={value || enumValues[0] || ''} onChange={(e) => onChange(e.target.value)}>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : type === 'number' || type === 'integer' ? (
        <input
          type="number"
          step={type === 'integer' ? '1' : 'any'}
          placeholder={description ?? ''}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : name === 'text' || name === 'code' || name === 'content' ? (
        <textarea
          placeholder={description ?? ''}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
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
