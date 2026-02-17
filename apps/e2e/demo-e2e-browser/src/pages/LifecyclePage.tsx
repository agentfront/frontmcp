import { useState, useEffect, useRef } from 'react';
import { useFrontMcp } from '@frontmcp/react';
import { StatusBadge } from '../components/StatusBadge';

interface StatusEntry {
  status: string;
  time: string;
}

export function LifecyclePage() {
  const { status, error, connect } = useFrontMcp();
  const [history, setHistory] = useState<StatusEntry[]>([]);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status !== prevStatus.current) {
      prevStatus.current = status;
      setHistory((prev) => [
        ...prev,
        {
          status,
          time: new Date().toLocaleTimeString('en-US', {
            hour12: false,
            fractionalSecondDigits: 1,
          } as Intl.DateTimeFormatOptions),
        },
      ]);
    }
  }, [status]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Provider Lifecycle</h2>
        <StatusBadge status={status} />
      </div>

      <p className="page-description">
        The FrontMcpProvider receives a pre-created server and manages the client connection lifecycle. Status
        transitions: idle &rarr; connecting &rarr; connected (or error).
      </p>

      <div className="section">
        <h3>Current State</h3>
        <div className="info-row">
          <span className="info-label">Status:</span>
          <span className="info-value">{status}</span>
        </div>
        {error && (
          <div className="info-row">
            <span className="info-label">Error:</span>
            <span className="info-value error-text">{error.message}</span>
          </div>
        )}
        {status !== 'connected' && (
          <button className="primary" onClick={connect} style={{ marginTop: '0.75rem' }}>
            Connect
          </button>
        )}
      </div>

      <div className="section">
        <h3>Status History</h3>
        {history.length === 0 ? (
          <p className="text-muted">No transitions recorded yet.</p>
        ) : (
          <div className="timeline">
            {history.map((entry, i) => (
              <div key={i} className="timeline-entry">
                <span className="timeline-time">{entry.time}</span>
                <span className={`timeline-status status-${entry.status}`}>{entry.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
