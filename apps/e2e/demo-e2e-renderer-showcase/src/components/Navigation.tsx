import React from 'react';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import type { RendererGroup } from '../fixtures';

interface NavigationProps {
  groups: RendererGroup[];
  selectedGroupId: string;
  onSelect: (groupId: string) => void;
}

export function Navigation({ groups, selectedGroupId, onSelect }: NavigationProps) {
  return (
    <List dense data-testid="renderer-nav">
      {groups.map((group) => (
        <ListItemButton
          key={group.id}
          selected={group.id === selectedGroupId}
          onClick={() => onSelect(group.id)}
          data-testid={`renderer-nav-${group.id}`}
        >
          <ListItemText primary={group.label} />
        </ListItemButton>
      ))}
    </List>
  );
}
