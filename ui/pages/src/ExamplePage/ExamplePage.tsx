import React from 'react';
import { Box, Typography } from '@mui/material';

export interface ExamplePageProps {
  title?: string;
}

export function ExamplePage({ title = 'Example Page' }: ExamplePageProps) {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4">{title}</Typography>
      <Typography variant="body1" sx={{ mt: 2 }}>
        TODO: implement ExamplePage
      </Typography>
    </Box>
  );
}
