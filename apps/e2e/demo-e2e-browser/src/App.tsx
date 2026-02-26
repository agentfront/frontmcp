import type { ComponentType } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { FrontMcpProvider, useFrontMcp } from '@frontmcp/react';
import { McpNavigation, ToolRoute, ResourceRoute, PromptRoute } from '@frontmcp/react/router';
import { useServerManager } from './context/ServerManagerContext';
import { ServerSelector } from './components/ServerSelector';
import { StatusBadge } from './components/StatusBadge';
import { HomePage } from './pages/HomePage';
import { LifecyclePage } from './pages/LifecyclePage';
import { HooksPage } from './pages/HooksPage';
import { DomPage } from './pages/DomPage';
import { RendererPage } from './pages/RendererPage';
import { ComponentsPage } from './pages/ComponentsPage';
import { StorePage } from './pages/StorePage';
import { OpenApiPage } from './pages/OpenApiPage';
import { ServerBuilderPage } from './pages/ServerBuilderPage';
import { ServerListPage } from './pages/ServerListPage';
import './App.css';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/lifecycle', label: 'Lifecycle' },
  { to: '/hooks', label: 'Hooks' },
  { to: '/store', label: 'Store' },
  { to: '/openapi', label: 'OpenAPI' },
  { to: '/dom', label: 'DOM' },
  { to: '/renderer', label: 'Renderer' },
  { to: '/components', label: 'Components' },
];

const serverNavItems = [
  { to: '/servers', label: 'Server List' },
  { to: '/server-builder', label: 'Server Builder' },
];

interface AppProps {
  components?: Record<string, ComponentType<Record<string, unknown>>>;
}

export function App({ components }: AppProps) {
  const { servers, activeServerId } = useServerManager();
  const activeServer = servers.find((s) => s.id === activeServerId);

  if (!activeServer) return <div>No active server</div>;

  return (
    <FrontMcpProvider key={activeServerId} server={activeServer.server} components={components} autoConnect>
      <AppLayout />
    </FrontMcpProvider>
  );
}

function AppLayout() {
  const { status } = useFrontMcp();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>FrontMCP</h1>
          <StatusBadge status={status} />
        </div>

        <div className="sidebar-server-section">
          <ServerSelector />
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Pages</div>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Servers</div>
            {serverNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {item.label}
              </NavLink>
            ))}
          </div>

          <div className="nav-section">
            <div className="nav-section-title">MCP Entities</div>
            <McpNavigation basePath="/mcp" />
          </div>
        </nav>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/lifecycle" element={<LifecyclePage />} />
          <Route path="/hooks" element={<HooksPage />} />
          <Route path="/store" element={<StorePage />} />
          <Route path="/openapi" element={<OpenApiPage />} />
          <Route path="/dom" element={<DomPage />} />
          <Route path="/renderer" element={<RendererPage />} />
          <Route path="/components" element={<ComponentsPage />} />
          <Route path="/servers" element={<ServerListPage />} />
          <Route path="/server-builder" element={<ServerBuilderPage />} />
          <Route path="/mcp/tools/:name" element={<ToolRoute />} />
          <Route path="/mcp/resources/*" element={<ResourceRoute />} />
          <Route path="/mcp/prompts/:name" element={<PromptRoute />} />
        </Routes>
      </main>
    </div>
  );
}
