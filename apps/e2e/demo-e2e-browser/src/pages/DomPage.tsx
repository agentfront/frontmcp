import { useState } from 'react';
import { readDomById, readDomBySelector, useCallTool } from '@frontmcp/react';

function formatData(data: unknown): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function DomPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h2>DOM Reading</h2>
      </div>
      <p className="page-description">
        Demonstrates readDomById and readDomBySelector from @frontmcp/react, plus MCP-mediated DOM reading via the
        ReadDomTool.
      </p>

      {/* Target DOM elements */}
      <div className="section">
        <h3>Target Elements</h3>
        <div
          id="demo-heading"
          style={{ padding: '0.5rem', border: '1px dashed var(--border)', borderRadius: 4, marginBottom: '0.5rem' }}
        >
          <strong>ID: demo-heading</strong> - This is a heading element
        </div>
        <div
          id="demo-content"
          className="demo-target"
          style={{ padding: '0.5rem', border: '1px dashed var(--border)', borderRadius: 4, marginBottom: '0.5rem' }}
        >
          <strong>ID: demo-content</strong> - This is a content element
        </div>
        <ul
          className="demo-target"
          style={{ padding: '0.5rem 0.5rem 0.5rem 1.5rem', border: '1px dashed var(--border)', borderRadius: 4 }}
        >
          <li>List item 1</li>
          <li>List item 2</li>
          <li>List item 3</li>
        </ul>
      </div>

      <DirectDomSection />
      <McpDomSection />
    </div>
  );
}

function DirectDomSection() {
  const [idTarget, setIdTarget] = useState('demo-heading');
  const [selectorTarget, setSelectorTarget] = useState('.demo-target');
  const [idResult, setIdResult] = useState<unknown>(null);
  const [selectorResult, setSelectorResult] = useState<unknown>(null);

  return (
    <div className="section">
      <h3>Direct DOM Reading</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>readDomById</label>
            <input type="text" value={idTarget} onChange={(e) => setIdTarget(e.target.value)} />
          </div>
          <button className="primary" onClick={() => setIdResult(readDomById(idTarget))}>
            Read by ID
          </button>
        </div>
        <div className="hook-state">
          <h4>Result</h4>
          <pre>{formatData(idResult)}</pre>
        </div>
      </div>

      <div className="hook-demo" style={{ marginTop: '1rem' }}>
        <div className="hook-input">
          <div className="form-group">
            <label>readDomBySelector</label>
            <input type="text" value={selectorTarget} onChange={(e) => setSelectorTarget(e.target.value)} />
          </div>
          <button className="primary" onClick={() => setSelectorResult(readDomBySelector(selectorTarget))}>
            Read by Selector
          </button>
        </div>
        <div className="hook-state">
          <h4>Result</h4>
          <pre>{formatData(selectorResult)}</pre>
        </div>
      </div>
    </div>
  );
}

function McpDomSection() {
  const [mode, setMode] = useState<'id' | 'selector'>('id');
  const [target, setTarget] = useState('demo-heading');
  const [callTool, state] = useCallTool<{ mode: string; target: string }>('read_dom');

  return (
    <div className="section">
      <h3>MCP-mediated DOM Reading (ReadDomTool)</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'id' | 'selector')}>
              <option value="id">id</option>
              <option value="selector">selector</option>
            </select>
          </div>
          <div className="form-group">
            <label>target</label>
            <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <button className="primary" onClick={() => callTool({ mode, target })}>
            Call read_dom
          </button>
        </div>
        <div className="hook-state">
          <h4>State</h4>
          <pre>
            {formatData({
              loading: state.loading,
              called: state.called,
              error: state.error?.message ?? null,
              data: state.data,
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}
