import { useServerManager } from '../context/ServerManagerContext';

export function ServerSelector() {
  const { servers, activeServerId, setActiveServer } = useServerManager();

  return (
    <div className="server-selector" data-testid="server-selector">
      <select
        value={activeServerId ?? ''}
        onChange={(e) => setActiveServer(e.target.value)}
        data-testid="server-select"
      >
        {servers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.config.toolIds.length}T / {s.config.resourceIds.length}R / {s.config.promptIds.length}P)
          </option>
        ))}
      </select>
    </div>
  );
}
