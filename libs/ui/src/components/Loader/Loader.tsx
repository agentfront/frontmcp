import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Backdrop from '@mui/material/Backdrop';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { useLoaderContext, type LoaderVariant, type CustomLoaderRender } from './LoaderContext';

export interface LoaderProps {
  variant?: LoaderVariant;
  determinate?: boolean;
  /** Progress value 0-100, for determinate mode. */
  value?: number;
  /** Spinner size in px. */
  size?: number;
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' | 'inherit';
  /** Text displayed below/beside the loader. */
  label?: string;
  skeletonShape?: 'text' | 'rectangular' | 'circular';
  skeletonWidth?: number | string;
  skeletonHeight?: number | string;
  /** Number of lines for multi-line text skeleton. */
  skeletonLines?: number;
  /** Overlay visibility. */
  open?: boolean;
  /** Use absolute positioning (scoped to parent) instead of fixed (full-screen). */
  contained?: boolean;
  /** Content rendered beneath the overlay. */
  children?: React.ReactNode;
  /** Per-instance custom render function. Overrides global custom loader. */
  custom?: CustomLoaderRender;
}

// ============================================
// Styled helpers
// ============================================

const LoaderRoot = styled(Box, {
  name: 'FrontMcpLoader',
  slot: 'Root',
})({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
});

const BarRoot = styled(Box, {
  name: 'FrontMcpLoader',
  slot: 'Bar',
})({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

const OverlayRoot = styled(Box, {
  name: 'FrontMcpLoader',
  slot: 'Overlay',
})({
  position: 'relative',
});

// ============================================
// Component
// ============================================

export function Loader({
  variant = 'spinner',
  determinate = false,
  value,
  size = 40,
  color = 'primary',
  label,
  skeletonShape = 'text',
  skeletonWidth,
  skeletonHeight,
  skeletonLines = 1,
  open = true,
  contained = false,
  children,
  custom,
}: LoaderProps): React.ReactElement {
  const { customLoader } = useLoaderContext();
  const renderFn = custom ?? customLoader;

  if (renderFn) {
    return renderFn({ variant, label, value });
  }

  switch (variant) {
    case 'bar':
      return (
        <BarRoot>
          <LinearProgress
            variant={determinate ? 'determinate' : 'indeterminate'}
            value={determinate ? value : undefined}
            color={color}
          />
          {label && (
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          )}
        </BarRoot>
      );

    case 'skeleton': {
      const lines = Math.max(1, skeletonLines);
      return (
        <Box>
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton
              key={i}
              variant={skeletonShape}
              width={skeletonWidth ?? (skeletonShape === 'circular' ? 40 : '100%')}
              height={skeletonHeight ?? (skeletonShape === 'circular' ? 40 : undefined)}
              animation="wave"
            />
          ))}
        </Box>
      );
    }

    case 'overlay':
      return (
        <OverlayRoot>
          {children}
          <Backdrop
            open={open}
            sx={{
              position: contained ? 'absolute' : 'fixed',
              zIndex: (theme) => theme.zIndex.drawer + 1,
              color: '#fff',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <CircularProgress color="inherit" size={size} />
            {label && (
              <Typography variant="body2" color="inherit">
                {label}
              </Typography>
            )}
          </Backdrop>
        </OverlayRoot>
      );

    case 'spinner':
    default:
      return (
        <LoaderRoot>
          <CircularProgress
            variant={determinate ? 'determinate' : 'indeterminate'}
            value={determinate ? value : undefined}
            size={size}
            color={color}
          />
          {label && (
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          )}
        </LoaderRoot>
      );
  }
}
