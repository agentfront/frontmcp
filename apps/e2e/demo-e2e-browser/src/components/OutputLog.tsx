import { useRef, useEffect } from 'react';

export interface LogEntry {
  id: number;
  time: string;
  op: string;
  data: string;
  isError: boolean;
}

interface OutputLogProps {
  entries: LogEntry[];
  onClear: () => void;
}

export function OutputLog({ entries, onClear }: OutputLogProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="output-container">
      <div className="output-header">
        <span>Output Log</span>
        <button onClick={onClear} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
          Clear
        </button>
      </div>
      <div className="output-log" ref={logRef}>
        {entries.map((entry) => (
          <div key={entry.id} className={`log-entry ${entry.isError ? 'error' : 'success'}`}>
            <span className="log-time">{entry.time}</span>
            <span className="log-op">{entry.op}</span>
            <span className="log-data">{entry.data}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
