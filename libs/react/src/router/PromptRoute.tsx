/**
 * PromptRoute — renders PromptForm + OutputDisplay for a specific prompt.
 */

import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useFrontMcp } from '../hooks/useFrontMcp';
import { useGetPrompt } from '../hooks/useGetPrompt';
import { PromptForm } from '../components/PromptForm';
import { OutputDisplay } from '../components/OutputDisplay';

export function PromptRoute(): React.ReactElement {
  const { name } = useParams<{ name: string }>();
  const { prompts } = useFrontMcp();
  const [getPrompt, state] = useGetPrompt(name ?? '');
  const [output, setOutput] = useState<unknown>(null);

  const prompt = prompts.find((p) => p.name === name);

  const handleSubmit = useCallback(
    async (args: Record<string, string>) => {
      const result = await getPrompt(args);
      setOutput(result);
    },
    [getPrompt],
  );

  if (!prompt) {
    return React.createElement('div', null, `Prompt "${name}" not found`);
  }

  return React.createElement(
    'div',
    null,
    React.createElement(PromptForm, { prompt, onSubmit: handleSubmit }),
    React.createElement(OutputDisplay, { data: output, loading: state.loading, error: state.error }),
  );
}
