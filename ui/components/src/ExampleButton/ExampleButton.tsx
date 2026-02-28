import React from 'react';
import { Box, Typography } from '@mui/material';

export interface ExampleButtonProps {
  label?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export function ExampleButton({ label = 'Click me', onClick }: ExampleButtonProps) {
  return (
    <Box onClick={onClick} sx={{ cursor: 'pointer', display: 'inline-block' }}>
      <Typography>{label}</Typography>
    </Box>
  );
}
