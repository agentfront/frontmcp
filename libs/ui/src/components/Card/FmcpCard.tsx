import React from 'react';
import { styled } from '@mui/material/styles';
import MuiCard from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import CardActionArea from '@mui/material/CardActionArea';

export interface FmcpCardSlotProps {
  root?: React.ComponentProps<typeof StyledCard>;
  header?: React.ComponentProps<typeof CardHeader>;
  content?: React.ComponentProps<typeof CardContent>;
  actions?: React.ComponentProps<typeof CardActions>;
}

export interface FmcpCardProps {
  title?: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  elevation?: number;
  clickable?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  slotProps?: FmcpCardSlotProps;
  children: React.ReactNode;
}

const StyledCard = styled(MuiCard, {
  name: 'FmcpCard',
  slot: 'Root',
})(({ theme }) => ({
  borderRadius: theme.shape.borderRadius,
  transition: theme.transitions.create(['box-shadow', 'border-color'], {
    duration: theme.transitions.duration.short,
  }),
}));

const StyledCardHeader = styled(CardHeader, {
  name: 'FmcpCard',
  slot: 'Header',
})(({ theme }) => ({
  '& .MuiCardHeader-title': {
    fontWeight: 600,
    fontSize: theme.typography.body1.fontSize,
  },
  '& .MuiCardHeader-subheader': {
    fontSize: theme.typography.body2.fontSize,
  },
}));

const StyledCardContent = styled(CardContent, {
  name: 'FmcpCard',
  slot: 'Content',
})({
  '&:last-child': {
    paddingBottom: 16,
  },
});

const StyledCardActions = styled(CardActions, {
  name: 'FmcpCard',
  slot: 'Actions',
})(({ theme }) => ({
  borderTop: `1px solid ${theme.palette.divider}`,
  padding: theme.spacing(1, 2),
}));

export function FmcpCard({
  title,
  subtitle,
  headerActions,
  footer,
  elevation = 1,
  clickable = false,
  onClick,
  slotProps,
  children,
}: FmcpCardProps): React.ReactElement {
  const header =
    title || subtitle || headerActions ? (
      <StyledCardHeader title={title} subheader={subtitle} action={headerActions} {...slotProps?.header} />
    ) : null;

  const content = <StyledCardContent {...slotProps?.content}>{children}</StyledCardContent>;

  const actions = footer ? <StyledCardActions {...slotProps?.actions}>{footer}</StyledCardActions> : null;

  if (clickable) {
    return (
      <StyledCard elevation={elevation} {...slotProps?.root}>
        <CardActionArea onClick={onClick}>
          {header}
          {content}
        </CardActionArea>
        {actions}
      </StyledCard>
    );
  }

  return (
    <StyledCard elevation={elevation} onClick={onClick} {...slotProps?.root}>
      {header}
      {content}
      {actions}
    </StyledCard>
  );
}
