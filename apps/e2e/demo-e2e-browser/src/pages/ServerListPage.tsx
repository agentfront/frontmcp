import { useServerManager } from '../context/ServerManagerContext';

export function ServerListPage() {
  const { servers, activeServerId, setActiveServer, removeServer } = useServerManager();

  return (
    <div className="page" data-testid="server-list-page">
      <div className="page-header">
        <h2>Servers</h2>
      </div>
      <p className="page-description">Manage all running MCP server instances.</p>

      <div className="server-card-grid">
        {servers.map((s) => {
          const isActive = s.id === activeServerId;
          return (
            <div key={s.id} className={`server-card ${isActive ? 'active' : ''}`} data-testid={`server-card-${s.id}`}>
              <div className="server-card-header">
                <h3>{s.name}</h3>
                {isActive && (
                  <span className="active-badge" data-testid="active-badge">
                    Active
                  </span>
                )}
              </div>
              <div className="server-card-body">
                <div className="server-card-stats">
                  <span>{s.config.toolIds.length} tools</span>
                  <span>{s.config.resourceIds.length} resources</span>
                  <span>{s.config.promptIds.length} prompts</span>
                  {s.config.hasStorePlugin && <span>+ Store</span>}
                </div>
                <div className="server-card-time">Created {new Date(s.createdAt).toLocaleTimeString()}</div>
              </div>
              <div className="server-card-actions">
                {!isActive && (
                  <button
                    className="primary"
                    onClick={() => setActiveServer(s.id)}
                    data-testid={`activate-btn-${s.id}`}
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => removeServer(s.id)}
                  disabled={servers.length <= 1}
                  data-testid={`remove-btn-${s.id}`}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
