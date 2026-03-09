import React from 'react';
import { styled } from '@mui/material/styles';
import MuiButton, { type ButtonProps as MuiButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  fullWidth?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  children: React.ReactNode;
}

function mapVariant(variant: ButtonVariant): Pick<MuiButtonProps, 'variant' | 'color'> {
  switch (variant) {
    case 'primary':
      return { variant: 'contained', color: 'primary' };
    case 'secondary':
      return { variant: 'outlined', color: 'secondary' };
    case 'danger':
      return { variant: 'contained', color: 'error' };
    case 'ghost':
      return { variant: 'text', color: 'inherit' };
  }
}

const StyledButton = styled(MuiButton, {
  name: 'Button',
  slot: 'Root',
})(({ theme }) => ({
  textTransform: 'none' as const,
  fontWeight: 500,
  borderRadius: theme.shape.borderRadius,
}));

export function Button({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  startIcon,
  endIcon,
  fullWidth = false,
  onClick,
  type = 'button',
  children,
}: ButtonProps): React.ReactElement {
  const mapped = mapVariant(variant);

  return (
    <StyledButton
      variant={mapped.variant}
      color={mapped.color}
      size={size}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : startIcon}
      endIcon={endIcon}
      fullWidth={fullWidth}
      onClick={onClick}
      type={type}
    >
      {children}
    </StyledButton>
  );
}
