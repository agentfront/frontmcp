import React from 'react';
import { styled } from '@mui/material/styles';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';

export interface FmcpModalSlotProps {
  title?: React.ComponentProps<typeof StyledDialogTitle>;
  content?: React.ComponentProps<typeof StyledDialogContent>;
  actions?: React.ComponentProps<typeof DialogActions>;
}

export interface FmcpModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions?: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  slotProps?: FmcpModalSlotProps;
  children: React.ReactNode;
}

const StyledDialogTitle = styled(DialogTitle, {
  name: 'FmcpModal',
  slot: 'Title',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontWeight: 600,
  fontSize: theme.typography.h6.fontSize,
}));

const StyledDialogContent = styled(DialogContent, {
  name: 'FmcpModal',
  slot: 'Content',
})(({ theme }) => ({
  paddingTop: `${theme.spacing(2)} !important`,
}));

export function FmcpModal({
  open,
  onClose,
  title,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  slotProps,
  children,
}: FmcpModalProps): React.ReactElement {
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth}>
      {title && (
        <StyledDialogTitle {...slotProps?.title}>
          {title}
          <IconButton onClick={onClose} size="small" aria-label="close">
            {'\u2715'}
          </IconButton>
        </StyledDialogTitle>
      )}
      <StyledDialogContent {...slotProps?.content}>{children}</StyledDialogContent>
      {actions && <DialogActions {...slotProps?.actions}>{actions}</DialogActions>}
    </Dialog>
  );
}
