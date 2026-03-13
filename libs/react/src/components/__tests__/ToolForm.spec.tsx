import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ToolForm } from '../ToolForm';
import type { ToolInfo, FieldRenderProps } from '../../types';

describe('ToolForm', () => {
  const baseTool: ToolInfo = {
    name: 'test-tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Your name' },
        age: { type: 'number', description: 'Your age' },
      },
      required: ['name'],
    },
  };

  it('renders form fields from inputSchema', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} />);

    const labels = container.querySelectorAll('label');
    expect(labels).toHaveLength(2);
    expect(labels[0].textContent).toBe('name *');
    expect(labels[1].textContent).toBe('age');

    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
  });

  it('submits with correct values', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} />);

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Alice' } });
    fireEvent.change(inputs[1], { target: { value: '30' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alice', age: 30 });
  });

  it('handles number type coercion', () => {
    const tool: ToolInfo = {
      name: 'num-tool',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    expect(input.type).toBe('number');
    fireEvent.change(input, { target: { value: '42' } });

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ count: 42 });
  });

  it('handles boolean type coercion', () => {
    const tool: ToolInfo = {
      name: 'bool-tool',
      inputSchema: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
        },
        required: ['active'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'true' } });

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ active: true });
  });

  it('handles boolean false coercion', () => {
    const tool: ToolInfo = {
      name: 'bool-tool',
      inputSchema: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
        },
        required: ['active'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'false' } });

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ active: false });
  });

  it('handles integer step attribute', () => {
    const tool: ToolInfo = {
      name: 'int-tool',
      inputSchema: {
        type: 'object',
        properties: {
          quantity: { type: 'integer' },
        },
        required: ['quantity'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    expect(input.type).toBe('number');
    expect(input.step).toBe('1');

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ quantity: 5 });
  });

  it('handles enum fields by rendering a select', () => {
    const tool: ToolInfo = {
      name: 'enum-tool',
      inputSchema: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['red', 'green', 'blue'] },
        },
        required: ['color'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const select = container.querySelector('select')!;
    expect(select).toBeTruthy();

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[0].value).toBe('red');
    expect(options[1].value).toBe('green');
    expect(options[2].value).toBe('blue');

    fireEvent.change(select, { target: { value: 'green' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ color: 'green' });
  });

  it('uses custom renderField', () => {
    const onSubmit = jest.fn();
    const renderField = (props: FieldRenderProps) =>
      React.createElement('input', {
        'data-testid': `custom-${props.name}`,
        value: props.value,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value),
      });

    const { getByTestId } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} renderField={renderField} />);

    const nameInput = getByTestId('custom-name') as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    fireEvent.change(nameInput, { target: { value: 'Bob' } });

    const form = nameInput.closest('form')!;
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bob' });
  });

  it('skips optional empty fields on submit', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} />);

    const inputs = container.querySelectorAll('input');
    // Only fill in the required field
    fireEvent.change(inputs[0], { target: { value: 'Alice' } });
    // Leave 'age' (optional) empty

    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alice' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('age');
  });

  it('shows required indicator on required fields', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} />);

    const labels = container.querySelectorAll('label');
    // 'name' is required
    expect(labels[0].textContent).toContain('*');
    // 'age' is not required
    expect(labels[1].textContent).not.toContain('*');
  });

  it('uses the default submit label', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} />);

    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Call Tool');
  });

  it('uses a custom submit label', () => {
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={baseTool} onSubmit={onSubmit} submitLabel="Execute" />);

    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Execute');
  });

  it('handles tool with no inputSchema', () => {
    const tool: ToolInfo = { name: 'empty-tool' };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(0);

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('handles tool with empty properties', () => {
    const tool: ToolInfo = {
      name: 'empty-props-tool',
      inputSchema: { type: 'object', properties: {} },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(0);
  });

  it('handles schema with no required array', () => {
    const tool: ToolInfo = {
      name: 'no-required',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const labels = container.querySelectorAll('label');
    expect(labels[0].textContent).toBe('name');
    expect(labels[0].textContent).not.toContain('*');
  });

  it('handles string type field (default)', () => {
    const tool: ToolInfo = {
      name: 'str-tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'A message' },
        },
        required: ['message'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('A message');

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ message: 'hello' });
  });

  it('handles property with no type (defaults to string)', () => {
    const tool: ToolInfo = {
      name: 'no-type-tool',
      inputSchema: {
        type: 'object',
        properties: {
          data: { description: 'Some data' },
        },
        required: ['data'],
      },
    };
    const onSubmit = jest.fn();

    const { container } = render(<ToolForm tool={tool} onSubmit={onSubmit} />);

    const input = container.querySelector('input')!;
    expect(input.type).toBe('text');

    fireEvent.change(input, { target: { value: 'value' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledWith({ data: 'value' });
  });
});
