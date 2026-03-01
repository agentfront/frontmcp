import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PreviewPanelProps {
  groupId: string;
  exampleIndex: number;
}

export function PreviewPanel({ groupId, exampleIndex }: PreviewPanelProps) {
  const src = `/#/render/${groupId}/${exampleIndex}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Box
        sx={{
          p: 1,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Preview — {src}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <iframe
          key={`${groupId}-${exampleIndex}`}
          src={src}
          data-testid="preview-iframe"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="Renderer Preview"
        />
      </Box>
    </Box>
  );
}
