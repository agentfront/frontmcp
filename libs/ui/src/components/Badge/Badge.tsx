import React from 'react';
import Chip, { type ChipProps } from '@mui/material/Chip';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
  dot?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  size?: 'small' | 'medium';
  icon?: React.ReactElement;
}

function mapColor(variant: BadgeVariant): ChipProps['color'] {
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

const DotIndicator = React.createElement('span', {
  style: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: 'currentColor',
    display: 'inline-block',
  },
});

export function Badge({
  variant = 'default',
  label,
  dot = false,
  removable = false,
  onRemove,
  size = 'small',
  icon,
}: BadgeProps): React.ReactElement {
  const avatarProp = dot && !icon ? { avatar: DotIndicator } : {};
  return (
    <Chip
      label={label}
      color={mapColor(variant)}
      size={size}
      icon={icon}
      {...avatarProp}
      onDelete={removable && onRemove ? onRemove : undefined}
      variant="filled"
    />
  );
}
