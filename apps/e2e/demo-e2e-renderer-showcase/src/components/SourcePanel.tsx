import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import type { RendererGroup } from '../fixtures';

interface SourcePanelProps {
  group: RendererGroup;
  selectedIndex: number;
  onSelectExample: (index: number) => void;
}

export function SourcePanel({ group, selectedIndex, onSelectExample }: SourcePanelProps) {
  const fixture = group.fixtures[selectedIndex] || group.fixtures[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
          Example:
        </Typography>
        <Select
          size="small"
          value={selectedIndex}
          onChange={(e) => onSelectExample(Number(e.target.value))}
          data-testid="example-selector"
          sx={{ flex: 1 }}
        >
          {group.fixtures.map((f, i) => (
            <MenuItem key={i} value={i}>
              {f.name}
            </MenuItem>
          ))}
        </Select>
      </Box>

      <Box sx={{ p: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {fixture.description}
        </Typography>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 1.5,
          pb: 1.5,
        }}
      >
        <Box
          component="pre"
          data-testid="source-content"
          sx={{
            m: 0,
            p: 1.5,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontSize: 12,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'auto',
          }}
        >
          {fixture.content}
        </Box>
      </Box>
    </Box>
  );
}
