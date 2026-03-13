import React from 'react';
import { render } from '@testing-library/react';
import { OutputDisplay } from '../OutputDisplay';

describe('OutputDisplay', () => {
  it('shows loading state', () => {
    const { getByTestId } = render(<OutputDisplay data={null} loading={true} />);

    const el = getByTestId('output-loading');
    expect(el.textContent).toBe('Loading...');
  });

  it('shows error state', () => {
    const error = new Error('Tool failed');

    const { getByTestId } = render(<OutputDisplay data={null} error={error} />);

    const el = getByTestId('output-error');
    expect(el.textContent).toBe('Error: Tool failed');
    expect(el.style.color).toBe('red');
  });

  it('shows empty state for null data', () => {
    const { getByTestId } = render(<OutputDisplay data={null} />);

    const el = getByTestId('output-empty');
    expect(el.textContent).toBe('');
  });

  it('shows empty state for undefined data', () => {
    const { getByTestId } = render(<OutputDisplay data={undefined} />);

    const el = getByTestId('output-empty');
    expect(el.textContent).toBe('');
  });

  it('renders string data', () => {
    const { getByTestId } = render(<OutputDisplay data="Hello from tool" />);

    const el = getByTestId('output-display');
    expect(el.tagName).toBe('PRE');
    expect(el.textContent).toBe('Hello from tool');
  });

  it('renders object as JSON', () => {
    const obj = { result: 'success', count: 3 };

    const { getByTestId } = render(<OutputDisplay data={obj} />);

    const el = getByTestId('output-display');
    expect(el.tagName).toBe('PRE');
    expect(el.textContent).toBe(JSON.stringify(obj, null, 2));
  });

  it('renders array as JSON', () => {
    const arr = [1, 2, 3];

    const { getByTestId } = render(<OutputDisplay data={arr} />);

    const el = getByTestId('output-display');
    expect(el.textContent).toBe(JSON.stringify(arr, null, 2));
  });

  it('renders number as JSON', () => {
    const { getByTestId } = render(<OutputDisplay data={42} />);

    const el = getByTestId('output-display');
    expect(el.textContent).toBe('42');
  });

  it('renders boolean as JSON', () => {
    const { getByTestId } = render(<OutputDisplay data={true} />);

    const el = getByTestId('output-display');
    expect(el.textContent).toBe('true');
  });

  it('has correct data-testid attributes', () => {
    // Loading
    const { getByTestId: getLoading, unmount: unmountLoading } = render(<OutputDisplay data={null} loading={true} />);
    expect(getLoading('output-loading')).toBeTruthy();
    unmountLoading();

    // Error
    const { getByTestId: getError, unmount: unmountError } = render(
      <OutputDisplay data={null} error={new Error('err')} />,
    );
    expect(getError('output-error')).toBeTruthy();
    unmountError();

    // Empty
    const { getByTestId: getEmpty, unmount: unmountEmpty } = render(<OutputDisplay data={null} />);
    expect(getEmpty('output-empty')).toBeTruthy();
    unmountEmpty();

    // Display
    const { getByTestId: getDisplay } = render(<OutputDisplay data="test" />);
    expect(getDisplay('output-display')).toBeTruthy();
  });

  it('prioritizes loading over error', () => {
    const { getByTestId, queryByTestId } = render(
      <OutputDisplay data={null} loading={true} error={new Error('err')} />,
    );

    expect(getByTestId('output-loading')).toBeTruthy();
    expect(queryByTestId('output-error')).toBeNull();
  });

  it('prioritizes error over data', () => {
    const { getByTestId, queryByTestId } = render(<OutputDisplay data="some data" error={new Error('err')} />);

    expect(getByTestId('output-error')).toBeTruthy();
    expect(queryByTestId('output-display')).toBeNull();
  });

  it('handles non-stringifiable data gracefully', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;

    const { getByTestId } = render(<OutputDisplay data={circular} />);

    const el = getByTestId('output-display');
    expect(el.textContent).toBe('[object Object]');
  });

  it('applies correct styling to pre element', () => {
    const { getByTestId } = render(<OutputDisplay data="styled output" />);

    const el = getByTestId('output-display');
    expect(el.style.overflow).toBe('auto');
    expect(el.style.whiteSpace).toBe('pre-wrap');
  });
});
