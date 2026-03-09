import React, { useState, useEffect, useCallback } from 'react';
import { RENDERER_GROUPS } from './fixtures';
import { ShowcaseLayout } from './ShowcaseLayout';
import { RenderOnly } from './RenderOnly';

interface RenderRoute {
  kind: 'render';
  groupId: string;
  exampleIndex: number;
}

interface ShowcaseRoute {
  kind: 'showcase';
  groupId: string;
  exampleIndex: number;
}

type Route = RenderRoute | ShowcaseRoute;

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');

  // Render-only mode: render/{group}/{index}
  const renderMatch = h.match(/^render\/([^/]+)\/(\d+)$/);
  if (renderMatch) {
    return {
      kind: 'render',
      groupId: renderMatch[1],
      exampleIndex: parseInt(renderMatch[2], 10),
    };
  }

  // Showcase mode: {group}?example={index} or just {group}
  const parts = h.split('?');
  const groupId = parts[0] || RENDERER_GROUPS[0].id;
  const params = new URLSearchParams(parts[1] || '');
  const exampleIndex = parseInt(params.get('example') || '0', 10);

  return { kind: 'showcase', groupId, exampleIndex };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);

  const navigate = useCallback((groupId: string, exampleIndex: number) => {
    window.location.hash = `#/${groupId}?example=${exampleIndex}`;
  }, []);

  if (route.kind === 'render') {
    return <RenderOnly groupId={route.groupId} exampleIndex={route.exampleIndex} themeMode={themeMode} />;
  }

  return (
    <ShowcaseLayout
      groupId={route.groupId}
      exampleIndex={route.exampleIndex}
      themeMode={themeMode}
      onToggleTheme={toggleTheme}
      onNavigate={navigate}
    />
  );
}
