import React from 'react';
import { FrontMcpThemeProvider } from '@frontmcp/ui/theme';
import { ContentView } from '@frontmcp/ui/renderer';
import { getGroup } from './fixtures';

interface RenderOnlyProps {
  groupId: string;
  exampleIndex: number;
  themeMode: 'light' | 'dark';
}

export function RenderOnly({ groupId, exampleIndex, themeMode }: RenderOnlyProps) {
  const group = getGroup(groupId);
  const fixture = group?.fixtures[exampleIndex];

  if (!group || !fixture) {
    return (
      <div data-testid="preview-content" style={{ padding: 16 }}>
        Unknown renderer: {groupId}/{exampleIndex}
      </div>
    );
  }

  return (
    <FrontMcpThemeProvider theme={{ mode: themeMode }}>
      <div data-testid="preview-content" style={{ padding: 16, minHeight: '100vh' }}>
        <ContentView content={fixture.content} />
      </div>
    </FrontMcpThemeProvider>
  );
}
