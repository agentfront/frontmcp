import React from 'react';
import MuiAvatar from '@mui/material/Avatar';

export interface AvatarProps {
  src?: string;
  alt?: string;
  children?: React.ReactNode;
  size?: number;
  variant?: 'circular' | 'rounded' | 'square';
}

export function Avatar({ src, alt, children, size = 40, variant = 'circular' }: AvatarProps): React.ReactElement {
  return (
    <MuiAvatar src={src} alt={alt} variant={variant} sx={{ width: size, height: size }}>
      {children}
    </MuiAvatar>
  );
}
