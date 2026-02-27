import React from 'react';
import MuiTextField from '@mui/material/TextField';

export interface FmcpTextFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  type?: 'text' | 'password' | 'email' | 'number' | 'url' | 'search';
  multiline?: boolean;
  rows?: number;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
}

export function FmcpTextField({
  label,
  placeholder,
  value,
  defaultValue,
  onChange,
  type = 'text',
  multiline = false,
  rows,
  error = false,
  helperText,
  disabled = false,
  required = false,
  fullWidth = true,
  size = 'small',
}: FmcpTextFieldProps): React.ReactElement {
  return (
    <MuiTextField
      label={label}
      placeholder={placeholder}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      type={type}
      multiline={multiline}
      rows={rows}
      error={error}
      helperText={helperText}
      disabled={disabled}
      required={required}
      fullWidth={fullWidth}
      size={size}
      variant="outlined"
    />
  );
}
