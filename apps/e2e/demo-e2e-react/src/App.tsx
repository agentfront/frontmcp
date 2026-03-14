import React, { useState, useEffect, useCallback } from 'react';
import type { DirectMcpServer, StoreAdapter } from '@frontmcp/react';
import { create, FrontMcpProvider, createStore } from '@frontmcp/react';
import { GreetTool } from './tools/greet.tool';
import { AddTool } from './tools/math.tool';
import { ProviderStatus } from './sections/ProviderStatus';
import { ToolCalling } from './sections/ToolCalling';
import { ToolListing } from './sections/ToolListing';
import { DynamicTool } from './sections/DynamicTool';
import { McpComponentSection } from './sections/McpComponentSection';
import { McpComponentTable } from './sections/McpComponentTable';
import { StoreAdapterSection } from './sections/StoreAdapterSection';

type Section = 'provider' | 'tool-calling' | 'tool-listing' | 'dynamic-tool' | 'mcp-component' | 'mcp-table' | 'store';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'provider', label: 'Provider Status' },
  { id: 'tool-calling', label: 'Tool Calling' },
  { id: 'tool-listing', label: 'Tool Listing' },
  { id: 'dynamic-tool', label: 'Dynamic Tool' },
  { id: 'mcp-component', label: 'MCP Component' },
  { id: 'mcp-table', label: 'MCP Table' },
  { id: 'store', label: 'Store Adapter' },
];

// Simple in-memory counter store
function createCounterStore(): StoreAdapter {
  let state = { count: 0 };
  const listeners = new Set<() => void>();

  return createStore({
    name: 'counter',
    getState: () => state,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    selectors: {
      count: (s) => (s as typeof state).count,
    },
    actions: {
      increment: () => {
        state = { count: state.count + 1 };
        listeners.forEach((cb) => cb());
        return state;
      },
    },
  });
}

function getHashSection(): Section {
  const hash = window.location.hash.replace('#', '');
  const valid = SECTIONS.map((s) => s.id);
  return valid.includes(hash as Section) ? (hash as Section) : 'provider';
}

function SectionContent({ section }: { section: Section }): React.ReactElement {
  switch (section) {
    case 'provider':
      return <ProviderStatus />;
    case 'tool-calling':
      return <ToolCalling />;
    case 'tool-listing':
      return <ToolListing />;
    case 'dynamic-tool':
      return <DynamicTool />;
    case 'mcp-component':
      return <McpComponentSection />;
    case 'mcp-table':
      return <McpComponentTable />;
    case 'store':
      return <StoreAdapterSection />;
  }
}

export function App(): React.ReactElement {
  const [server, setServer] = useState<DirectMcpServer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(getHashSection);
  const [counterStore] = useState<StoreAdapter>(createCounterStore);

  // Listen for hash changes
  useEffect(() => {
    const onHashChange = () => setSection(getHashSection());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Initialize MCP server
  useEffect(() => {
    let cancelled = false;

    create({
      info: { name: 'e2e-react', version: '1.0.0' },
      tools: [GreetTool, AddTool],
    })
      .then((srv) => {
        if (!cancelled) setServer(srv);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const navigateTo = useCallback((id: Section) => {
    window.location.hash = id;
  }, []);

  if (error) {
    return <div data-testid="init-error">Error: {error}</div>;
  }

  if (!server) {
    return <div data-testid="loading">Initializing MCP server...</div>;
  }

  return (
    <FrontMcpProvider
      server={server}
      stores={[counterStore]}
      onError={(err) => console.error('Provider connection error:', err)}
    >
      <div style={{ display: 'flex', height: '100vh' }}>
        <nav style={{ width: 200, padding: 16, borderRight: '1px solid #ccc' }}>
          <h3>Sections</h3>
          {SECTIONS.map((s) => (
            <div key={s.id} style={{ marginBottom: 8 }}>
              <a
                data-testid={`nav-${s.id}`}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo(s.id);
                }}
                style={{ fontWeight: section === s.id ? 'bold' : 'normal' }}
              >
                {s.label}
              </a>
            </div>
          ))}
        </nav>
        <main style={{ flex: 1, padding: 16 }} data-testid="section-content">
          <SectionContent section={section} />
        </main>
      </div>
    </FrontMcpProvider>
  );
}
