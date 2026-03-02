import { useState } from 'react';
import { useCallTool, useReadResource, useGetPrompt } from '@frontmcp/react';

function formatData(data: unknown): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function HooksPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h2>Hooks</h2>
      </div>
      <p className="page-description">Demonstrates useCallTool, useReadResource, and useGetPrompt hooks.</p>

      <CallToolSection />
      <ReadResourceSection />
      <GetPromptSection />
    </div>
  );
}

function CallToolSection() {
  const [name, setName] = useState('World');
  const [callTool, state, reset] = useCallTool<{ name: string }>('greet');

  return (
    <div className="section">
      <h3>useCallTool('greet')</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter name" />
          </div>
          <div className="button-row">
            <button className="primary" onClick={() => callTool({ name })}>
              Call
            </button>
            <button onClick={reset}>Reset</button>
          </div>
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

function ReadResourceSection() {
  const [uri, setUri] = useState('app://info');
  const [readResource, state] = useReadResource();

  return (
    <div className="section">
      <h3>useReadResource()</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>URI</label>
            <input type="text" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="Resource URI" />
          </div>
          <button className="primary" onClick={() => readResource(uri)}>
            Read
          </button>
        </div>
        <div className="hook-state">
          <h4>State</h4>
          <pre>{formatData({ loading: state.loading, error: state.error?.message ?? null, data: state.data })}</pre>
        </div>
      </div>
    </div>
  );
}

function GetPromptSection() {
  const [text, setText] = useState('FrontMCP runs in the browser with zero Node.js dependencies.');
  const [getPrompt, state] = useGetPrompt('summarize');

  return (
    <div className="section">
      <h3>useGetPrompt('summarize')</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <div className="form-group">
            <label>text</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to summarize" />
          </div>
          <button className="primary" onClick={() => getPrompt({ text })}>
            Get Prompt
          </button>
        </div>
        <div className="hook-state">
          <h4>State</h4>
          <pre>{formatData({ loading: state.loading, error: state.error?.message ?? null, data: state.data })}</pre>
        </div>
      </div>
    </div>
  );
}
