import React from 'react';
import { FrontMcpThemeProvider } from '@frontmcp/ui/theme';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import { Navigation } from './components/Navigation';
import { SourcePanel } from './components/SourcePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { RENDERER_GROUPS, getGroup } from './fixtures';

interface ShowcaseLayoutProps {
  groupId: string;
  exampleIndex: number;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate: (groupId: string, exampleIndex: number) => void;
}

export function ShowcaseLayout({ groupId, exampleIndex, themeMode, onToggleTheme, onNavigate }: ShowcaseLayoutProps) {
  const group = getGroup(groupId) || RENDERER_GROUPS[0];
  const fixture = group.fixtures[exampleIndex] || group.fixtures[0];
  const safeIndex = group.fixtures.indexOf(fixture);

  return (
    <FrontMcpThemeProvider theme={{ mode: themeMode }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <AppBar position="static" elevation={1}>
          <Toolbar variant="dense">
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              FrontMCP Renderer Showcase
            </Typography>
            <IconButton
              color="inherit"
              onClick={onToggleTheme}
              data-testid="theme-toggle"
              aria-label="Toggle theme"
              size="small"
            >
              {themeMode === 'light' ? '🌙' : '☀️'}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Box
            sx={{
              width: 220,
              flexShrink: 0,
              borderRight: 1,
              borderColor: 'divider',
              overflow: 'auto',
            }}
          >
            <Navigation groups={RENDERER_GROUPS} selectedGroupId={group.id} onSelect={(id) => onNavigate(id, 0)} />
          </Box>

          <Box
            sx={{
              flex: 1,
              overflow: 'auto',
              borderRight: 1,
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SourcePanel
              group={group}
              selectedIndex={safeIndex}
              onSelectExample={(index) => onNavigate(group.id, index)}
            />
          </Box>

          <Box sx={{ flex: 1.5, overflow: 'hidden', display: 'flex' }}>
            <PreviewPanel groupId={group.id} exampleIndex={safeIndex} />
          </Box>
        </Box>
      </Box>
    </FrontMcpThemeProvider>
  );
}
