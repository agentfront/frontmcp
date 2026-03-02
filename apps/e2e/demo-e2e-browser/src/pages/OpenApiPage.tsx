import { useListTools, useCallTool } from '@frontmcp/react';
import { useState } from 'react';

export function OpenApiPage() {
  const tools = useListTools();
  const petStoreTools = tools.filter(
    (t) => t.name.startsWith('findPets') || t.name.startsWith('getPet') || t.name.startsWith('getInventory'),
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>OpenAPI Adapter</h2>
      </div>
      <p>PetStore API tools generated from an OpenAPI spec, running in the browser.</p>

      <div className="section">
        <h3>PetStore Tools ({petStoreTools.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {petStoreTools.map((tool) => (
            <div key={tool.name} className="stat-card">
              <strong>{tool.name}</strong>
              <p style={{ margin: '4px 0 0', fontSize: '0.9em', opacity: 0.7 }}>{tool.description}</p>
            </div>
          ))}
          {petStoreTools.length === 0 && <p style={{ opacity: 0.6 }}>No PetStore tools found. Check adapter config.</p>}
        </div>
      </div>

      <FindPetsSection />
      <InventorySection />
    </div>
  );
}

function FindPetsSection() {
  const [status, setStatus] = useState('available');
  const [callTool, state] = useCallTool('findPetsByStatus');

  const search = async () => {
    await callTool({ status });
  };

  return (
    <div className="section">
      <h3>Find Pets by Status</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="available">Available</option>
              <option value="pending">Pending</option>
              <option value="sold">Sold</option>
            </select>
          </div>
          <button className="primary" onClick={search} disabled={state.loading}>
            {state.loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="hook-state">
          <h4>Result</h4>
          {state.error && <p style={{ color: 'red' }}>Error: {state.error.message}</p>}
          <pre style={{ maxHeight: '300px', overflow: 'auto' }}>
            {state.data ? JSON.stringify(state.data, null, 2) : 'No results yet'}
          </pre>
        </div>
      </div>
    </div>
  );
}

function InventorySection() {
  const [callTool, state] = useCallTool('getInventory');

  return (
    <div className="section">
      <h3>Store Inventory</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <button className="primary" onClick={() => callTool({})} disabled={state.loading}>
            {state.loading ? 'Loading...' : 'Get Inventory'}
          </button>
        </div>
        <div className="hook-state">
          <h4>Result</h4>
          {state.error && <p style={{ color: 'red' }}>Error: {state.error.message}</p>}
          <pre>{state.data ? JSON.stringify(state.data, null, 2) : 'No results yet'}</pre>
        </div>
      </div>
    </div>
  );
}
