import React from 'react';
import Chip, { type ChipProps } from '@mui/material/Chip';

export type FmcpBadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface FmcpBadgeProps {
  variant?: FmcpBadgeVariant;
  label: string;
  dot?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  size?: 'small' | 'medium';
  icon?: React.ReactElement;
}

function mapColor(variant: FmcpBadgeVariant): ChipProps['color'] {
  switch (variant) {
    case 'default':
      return 'default';
    case 'primary':
      return 'primary';
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    case 'info':
      return 'info';
  }
}

export function FmcpBadge({
  variant = 'default',
  label,
  removable = false,
  onRemove,
  size = 'small',
  icon,
}: FmcpBadgeProps): React.ReactElement {
  return (
    <Chip
      label={label}
      color={mapColor(variant)}
      size={size}
      icon={icon}
      onDelete={removable ? (onRemove ?? (() => {})) : undefined}
      variant="filled"
    />
  );
}
