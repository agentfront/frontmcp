/**
 * ToolRoute — renders ToolForm + OutputDisplay for a specific tool.
 */

import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useFrontMcp } from '../hooks/useFrontMcp';
import { useCallTool } from '../hooks/useCallTool';
import { ToolForm } from '../components/ToolForm';
import { OutputDisplay } from '../components/OutputDisplay';

export function ToolRoute(): React.ReactElement {
  const { name: rawName } = useParams<{ name: string }>();
  let name = rawName ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // malformed percent-encoding — use raw value
  }
  const { tools } = useFrontMcp();
  const [callTool, state] = useCallTool(name);
  const [output, setOutput] = useState<unknown>(null);

  const tool = tools.find((t) => t.name === name);

  const handleSubmit = useCallback(
    async (args: Record<string, unknown>) => {
      const result = await callTool(args);
      setOutput(result);
    },
    [callTool],
  );

  if (!tool) {
    return React.createElement('div', null, `Tool "${name}" not found`);
  }

  return React.createElement(
    'div',
    null,
    React.createElement(ToolForm, { tool, onSubmit: handleSubmit }),
    React.createElement(OutputDisplay, { data: output, loading: state.loading, error: state.error }),
  );
}
