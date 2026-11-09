/**
 * Counter Widget - a React widget the server renders and the page hydrates (`ui.hydrate`).
 */

import { useState } from 'react';

interface CounterOutput {
  label: string;
  start: number;
}

export default function CounterWidget({ output, loading }: { output: CounterOutput | null; loading?: boolean }) {
  const [count, setCount] = useState(output?.start ?? 0);
  if (loading || !output) return <p className="counter-loading">Loading counter...</p>;
  return (
    <div className="counter">
      <span>
        {output.label}: {count}
      </span>
      <button type="button" onClick={() => setCount(count + 1)}>
        +1
      </button>
    </div>
  );
}
