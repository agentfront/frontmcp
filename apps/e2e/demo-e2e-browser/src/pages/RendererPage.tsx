import { useState } from 'react';
import { useFrontMcp, DynamicRenderer } from '@frontmcp/react';
import type { ComponentNode } from '@frontmcp/react';
import { sampleTrees } from '../registry/demo-trees';

export function RendererPage() {
  const { registry } = useFrontMcp();
  const treeNames = Object.keys(sampleTrees);
  const [selectedTree, setSelectedTree] = useState(treeNames[0]);
  const [jsonText, setJsonText] = useState(JSON.stringify(sampleTrees[treeNames[0]], null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [tree, setTree] = useState<ComponentNode>(sampleTrees[treeNames[0]]);

  const registryEntries = registry.list();

  const handleTreeSelect = (name: string) => {
    setSelectedTree(name);
    const t = sampleTrees[name];
    setJsonText(JSON.stringify(t, null, 2));
    setTree(t);
    setParseError(null);
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setTree(parsed);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>DynamicRenderer</h2>
      </div>
      <p className="page-description">
        ComponentRegistry maps URIs to React components. DynamicRenderer recursively renders a ComponentNode tree.
      </p>

      <div className="section">
        <h3>Registered Components</h3>
        {registryEntries.length === 0 ? (
          <p className="text-muted">No components registered.</p>
        ) : (
          <div className="registry-list">
            {registryEntries.map((entry) => (
              <div key={entry.uri} className="registry-entry">
                <span className="registry-name">{entry.name}</span>
                <span className="registry-uri">{entry.uri}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h3>Tree Editor</h3>
        <div className="button-row" style={{ marginBottom: '0.75rem' }}>
          {treeNames.map((name) => (
            <button
              key={name}
              className={selectedTree === name ? 'primary' : ''}
              onClick={() => handleTreeSelect(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <textarea
          className="tree-editor"
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          spellCheck={false}
        />
        {parseError && (
          <div className="error-text" style={{ marginTop: '0.5rem' }}>
            Parse error: {parseError}
          </div>
        )}
      </div>

      <div className="section">
        <h3>Rendered Output</h3>
        <div className="renderer-output">
          {parseError ? (
            <p className="text-muted">Fix JSON to see output.</p>
          ) : (
            <DynamicRenderer tree={tree} registry={registry} />
          )}
        </div>
      </div>
    </div>
  );
}
