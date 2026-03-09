import React from 'react';
import MuiTextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
}

export function Select({
  label,
  value,
  defaultValue,
  onChange,
  options,
  placeholder,
  error = false,
  helperText,
  disabled = false,
  required = false,
  fullWidth = true,
  size = 'small',
}: SelectProps): React.ReactElement {
  return (
    <MuiTextField
      select
      label={label}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      error={error}
      helperText={helperText}
      disabled={disabled}
      required={required}
      fullWidth={fullWidth}
      size={size}
      variant="outlined"
    >
      {placeholder && (
        <MenuItem value="" disabled>
          {placeholder}
        </MenuItem>
      )}
      {options.map((opt) => (
        <MenuItem key={opt.value} value={opt.value}>
          {opt.label}
        </MenuItem>
      ))}
    </MuiTextField>
  );
}
