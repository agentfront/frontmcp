import React, { useState } from 'react';
import MuiAlert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';

export interface AlertProps {
  severity?: 'success' | 'info' | 'warning' | 'error';
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Alert({
  severity = 'info',
  title,
  dismissible = false,
  onDismiss,
  icon,
  children,
}: AlertProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleClose = dismissible
    ? () => {
        setDismissed(true);
        onDismiss?.();
      }
    : undefined;

  return (
    <MuiAlert severity={severity} onClose={handleClose} icon={icon}>
      {title && <AlertTitle>{title}</AlertTitle>}
      {children}
    </MuiAlert>
  );
}
