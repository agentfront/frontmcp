import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerManager, type ServerConfig } from '../context/ServerManagerContext';
import { toolCatalog, resourceCatalog, promptCatalog } from '../catalog/available-entries';

export function ServerBuilderPage() {
  const { createServer, setActiveServer } = useServerManager();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [hasStorePlugin, setHasStorePlugin] = useState(false);
  const [creating, setCreating] = useState(false);

  const toggleItem = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const config: ServerConfig = {
        toolIds: selectedTools,
        resourceIds: selectedResources,
        promptIds: selectedPrompts,
        hasStorePlugin,
      };
      const managed = await createServer(name.trim(), config);
      setActiveServer(managed.id);
      navigate('/');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page" data-testid="server-builder-page">
      <div className="page-header">
        <h2>Server Builder</h2>
      </div>
      <p className="page-description">Configure and create a new MCP server with selected entries.</p>

      <div className="section">
        <h3>Server Name</h3>
        <div className="form-group">
          <input
            type="text"
            placeholder="My Custom Server"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="server-name-input"
          />
        </div>
      </div>

      <div className="section builder-section">
        <h3>Tools</h3>
        <div className="checkbox-grid" data-testid="tools-grid">
          {toolCatalog.map((item) => (
            <label key={item.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedTools.includes(item.id)}
                onChange={() => toggleItem(selectedTools, setSelectedTools, item.id)}
                data-testid={`tool-checkbox-${item.id}`}
              />
              <span className="checkbox-label">
                <strong>{item.name}</strong>
                <span className="checkbox-desc">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="section builder-section">
        <h3>Resources</h3>
        <div className="checkbox-grid" data-testid="resources-grid">
          {resourceCatalog.map((item) => (
            <label key={item.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedResources.includes(item.id)}
                onChange={() => toggleItem(selectedResources, setSelectedResources, item.id)}
                data-testid={`resource-checkbox-${item.id}`}
              />
              <span className="checkbox-label">
                <strong>{item.name}</strong>
                <span className="checkbox-desc">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="section builder-section">
        <h3>Prompts</h3>
        <div className="checkbox-grid" data-testid="prompts-grid">
          {promptCatalog.map((item) => (
            <label key={item.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedPrompts.includes(item.id)}
                onChange={() => toggleItem(selectedPrompts, setSelectedPrompts, item.id)}
                data-testid={`prompt-checkbox-${item.id}`}
              />
              <span className="checkbox-label">
                <strong>{item.name}</strong>
                <span className="checkbox-desc">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="section builder-section">
        <h3>Plugins</h3>
        <label className="checkbox-item">
          <input
            type="checkbox"
            checked={hasStorePlugin}
            onChange={() => setHasStorePlugin(!hasStorePlugin)}
            data-testid="store-plugin-checkbox"
          />
          <span className="checkbox-label">
            <strong>Store Plugin</strong>
            <span className="checkbox-desc">Counter + Todo Valtio stores as MCP resources</span>
          </span>
        </label>
      </div>

      <button
        className="primary"
        onClick={handleCreate}
        disabled={!name.trim() || creating}
        data-testid="create-server-btn"
      >
        {creating ? 'Creating...' : 'Create Server'}
      </button>
    </div>
  );
}
