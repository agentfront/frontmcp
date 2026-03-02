import { useState } from 'react';
import { useFrontMcp, ToolForm, PromptForm, ResourceViewer, OutputDisplay } from '@frontmcp/react';
import { StyledField } from '../components/StyledField';
import { OutputLog, type LogEntry } from '../components/OutputLog';

let logIdCounter = 0;

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    fractionalSecondDigits: 1,
  } as Intl.DateTimeFormatOptions);
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function ComponentsPage() {
  const { tools, prompts, client } = useFrontMcp();
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [toolLoading, setToolLoading] = useState(false);
  const [toolError, setToolError] = useState<Error | null>(null);
  const [resourceResult, setResourceResult] = useState<{
    contents?: Array<{ uri: string; mimeType?: string; text?: string }>;
  } | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<Error | null>(null);
  const [selectedTool, setSelectedTool] = useState(0);
  const [selectedPrompt, setSelectedPrompt] = useState(0);

  const appendLog = (op: string, data: unknown, isError = false) => {
    setLogEntries((prev) => [...prev, { id: ++logIdCounter, time: formatTime(), op, data: formatData(data), isError }]);
  };

  const handleCallTool = async (args: Record<string, unknown>) => {
    const tool = tools[selectedTool];
    if (!tool || !client) return;
    setToolLoading(true);
    setToolError(null);
    appendLog(`callTool('${tool.name}')`, args);
    try {
      const result = await client.callTool(tool.name, args);
      setToolResult(result);
      setToolLoading(false);
      appendLog('result', result);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setToolError(e);
      setToolLoading(false);
      appendLog('error', e.message, true);
    }
  };

  const handleGetPrompt = async (args: Record<string, string>) => {
    const prompt = prompts[selectedPrompt];
    if (!prompt || !client) return;
    appendLog(`getPrompt('${prompt.name}')`, args);
    try {
      const result = await client.getPrompt(prompt.name, args);
      appendLog('result', result);
    } catch (err) {
      appendLog('error', err instanceof Error ? err.message : String(err), true);
    }
  };

  const handleReadResource = async () => {
    if (!client) return;
    setResourceLoading(true);
    setResourceError(null);
    appendLog('readResource', 'app://info');
    try {
      const result = await client.readResource('app://info');
      setResourceResult(result as { contents?: Array<{ uri: string; mimeType?: string; text?: string }> });
      setResourceLoading(false);
      appendLog('result', result);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setResourceError(e);
      setResourceLoading(false);
      appendLog('error', e.message, true);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Library Components</h2>
      </div>
      <p className="page-description">
        Built-in components from @frontmcp/react with the dark-themed renderField callback.
      </p>

      {/* ToolForm */}
      <div className="section">
        <h3>ToolForm</h3>
        {tools.length > 0 && (
          <>
            <div className="button-row" style={{ marginBottom: '0.75rem' }}>
              {tools.map((t, i) => (
                <button
                  key={t.name}
                  className={selectedTool === i ? 'primary' : ''}
                  onClick={() => {
                    setSelectedTool(i);
                    setToolResult(null);
                    setToolError(null);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <ToolForm
              tool={tools[selectedTool]}
              onSubmit={handleCallTool}
              renderField={StyledField}
              submitLabel="Call Tool"
            />
            <div style={{ marginTop: '0.75rem' }}>
              <OutputDisplay data={toolResult} loading={toolLoading} error={toolError} />
            </div>
          </>
        )}
      </div>

      {/* PromptForm */}
      <div className="section">
        <h3>PromptForm</h3>
        {prompts.length > 0 && (
          <>
            <div className="button-row" style={{ marginBottom: '0.75rem' }}>
              {prompts.map((p, i) => (
                <button
                  key={p.name}
                  className={selectedPrompt === i ? 'primary' : ''}
                  onClick={() => setSelectedPrompt(i)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <PromptForm
              prompt={prompts[selectedPrompt]}
              onSubmit={handleGetPrompt}
              renderField={StyledField}
              submitLabel="Get Prompt"
            />
          </>
        )}
      </div>

      {/* ResourceViewer */}
      <div className="section">
        <h3>ResourceViewer</h3>
        <button className="primary" onClick={handleReadResource} style={{ marginBottom: '0.75rem' }}>
          Read app://info
        </button>
        <ResourceViewer data={resourceResult} loading={resourceLoading} error={resourceError} />
      </div>

      {/* Output Log */}
      <OutputLog entries={logEntries} onClear={() => setLogEntries([])} />
    </div>
  );
}
