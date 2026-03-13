import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { PromptForm } from '../PromptForm';
import type { PromptInfo, FieldRenderProps } from '../../types';

describe('PromptForm', () => {
  const basePrompt: PromptInfo = {
    name: 'test-prompt',
    description: 'A test prompt',
    arguments: [
      { name: 'topic', description: 'The topic', required: true },
      { name: 'style', description: 'Writing style', required: false },
    ],
  };

  it('renders form from prompt.arguments', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    const labels = container.querySelectorAll('label');
    expect(labels).toHaveLength(2);
    expect(labels[0].textContent).toBe('topic *');
    expect(labels[1].textContent).toBe('style');

    const textareas = container.querySelectorAll('textarea');
    expect(textareas).toHaveLength(2);
    expect(textareas[0].placeholder).toBe('The topic');
    expect(textareas[1].placeholder).toBe('Writing style');
  });

  it('submits with correct values', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    const textareas = container.querySelectorAll('textarea');
    fireEvent.change(textareas[0], { target: { value: 'AI Safety' } });
    fireEvent.change(textareas[1], { target: { value: 'formal' } });

    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({
      topic: 'AI Safety',
      style: 'formal',
    });
  });

  it('submits empty strings for unfilled arguments', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    // Do not fill in any values
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({
      topic: '',
      style: '',
    });
  });

  it('uses custom renderField', () => {
    const onSubmit = jest.fn();
    const renderField = (props: FieldRenderProps) =>
      React.createElement('input', {
        'data-testid': `custom-${props.name}`,
        type: 'text',
        value: props.value,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value),
      });

    const { getByTestId, container } = render(
      <PromptForm prompt={basePrompt} onSubmit={onSubmit} renderField={renderField} />,
    );

    const topicInput = getByTestId('custom-topic') as HTMLInputElement;
    expect(topicInput).toBeTruthy();

    const styleInput = getByTestId('custom-style') as HTMLInputElement;
    expect(styleInput).toBeTruthy();

    fireEvent.change(topicInput, { target: { value: 'Testing' } });
    fireEvent.change(styleInput, { target: { value: 'casual' } });

    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({
      topic: 'Testing',
      style: 'casual',
    });
  });

  it('handles required indicator', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    const labels = container.querySelectorAll('label');
    expect(labels[0].textContent).toContain('*');
    expect(labels[1].textContent).not.toContain('*');
  });

  it('handles empty arguments array', () => {
    const prompt: PromptInfo = {
      name: 'no-args-prompt',
      arguments: [],
    };
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={prompt} onSubmit={onSubmit} />);

    const textareas = container.querySelectorAll('textarea');
    expect(textareas).toHaveLength(0);

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('handles undefined arguments', () => {
    const prompt: PromptInfo = {
      name: 'no-args-prompt',
    };
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={prompt} onSubmit={onSubmit} />);

    const textareas = container.querySelectorAll('textarea');
    expect(textareas).toHaveLength(0);

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('uses default submit label', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Get Prompt');
  });

  it('uses custom submit label', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} submitLabel="Send" />);

    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Send');
  });

  it('renders textarea with correct attributes', () => {
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} />);

    const textareas = container.querySelectorAll('textarea');
    expect(textareas[0].id).toBe('prompt-topic');
    expect(textareas[0].rows).toBe(3);
    expect(textareas[1].id).toBe('prompt-style');
  });

  it('passes correct props to custom renderField', () => {
    const onSubmit = jest.fn();
    const renderField = jest.fn((props: FieldRenderProps) =>
      React.createElement('div', { key: props.name }, props.name),
    );

    render(<PromptForm prompt={basePrompt} onSubmit={onSubmit} renderField={renderField} />);

    expect(renderField).toHaveBeenCalledTimes(2);
    expect(renderField).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'topic',
        type: 'string',
        required: true,
        description: 'The topic',
        value: '',
      }),
    );
    expect(renderField).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'style',
        type: 'string',
        required: false,
        description: 'Writing style',
        value: '',
      }),
    );
  });

  it('handles argument with no description', () => {
    const prompt: PromptInfo = {
      name: 'prompt',
      arguments: [{ name: 'query', required: true }],
    };
    const onSubmit = jest.fn();

    const { container } = render(<PromptForm prompt={prompt} onSubmit={onSubmit} />);

    const textarea = container.querySelector('textarea')!;
    expect(textarea.placeholder).toBe('');
  });
});
