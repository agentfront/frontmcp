import React from 'react';
import MuiList from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';

export interface FmcpListItem {
  id: string;
  primary: string;
  secondary?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  divider?: boolean;
}

export interface FmcpListProps {
  items: FmcpListItem[];
  dense?: boolean;
}

export function FmcpList({ items, dense = false }: FmcpListProps): React.ReactElement {
  return (
    <MuiList dense={dense}>
      {items.map((item) => {
        const content = (
          <>
            {item.icon && <ListItemIcon>{item.icon}</ListItemIcon>}
            <ListItemText primary={item.primary} secondary={item.secondary} />
          </>
        );

        return (
          <React.Fragment key={item.id}>
            {item.onClick ? (
              <ListItemButton onClick={item.onClick}>{content}</ListItemButton>
            ) : (
              <ListItem>{content}</ListItem>
            )}
            {item.divider && <Divider />}
          </React.Fragment>
        );
      })}
    </MuiList>
  );
}
