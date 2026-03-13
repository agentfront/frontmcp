import React from 'react';
import { render } from '@testing-library/react';
import { ResourceViewer } from '../ResourceViewer';

describe('ResourceViewer', () => {
  it('shows loading state', () => {
    const { getByTestId } = render(<ResourceViewer data={null} loading={true} />);

    const el = getByTestId('resource-loading');
    expect(el.textContent).toBe('Loading...');
  });

  it('shows error state', () => {
    const error = new Error('Something went wrong');

    const { getByTestId } = render(<ResourceViewer data={null} error={error} />);

    const el = getByTestId('resource-error');
    expect(el.textContent).toBe('Error: Something went wrong');
    expect(el.style.color).toBe('red');
  });

  it('shows empty state when data is null', () => {
    const { getByTestId } = render(<ResourceViewer data={null} />);

    const el = getByTestId('resource-empty');
    expect(el.textContent).toBe('No content');
  });

  it('shows empty state when data has no contents', () => {
    const { getByTestId } = render(<ResourceViewer data={{ contents: undefined }} />);

    const el = getByTestId('resource-empty');
    expect(el.textContent).toBe('No content');
  });

  it('shows empty state when contents array is empty', () => {
    const { getByTestId } = render(<ResourceViewer data={{ contents: [] }} />);

    const el = getByTestId('resource-empty');
    expect(el.textContent).toBe('No content');
  });

  it('renders text content', () => {
    const data = {
      contents: [{ uri: 'file:///readme.txt', text: 'Hello World' }],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    expect(viewer.textContent).toContain('file:///readme.txt');
    expect(viewer.textContent).toContain('Hello World');
  });

  it('renders JSON content pretty-printed', () => {
    const jsonObj = { key: 'value', nested: { num: 42 } };
    const data = {
      contents: [
        {
          uri: 'api://data',
          mimeType: 'application/json',
          text: JSON.stringify(jsonObj),
        },
      ],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    const pre = viewer.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(JSON.stringify(jsonObj, null, 2));
  });

  it('handles invalid JSON content gracefully', () => {
    const data = {
      contents: [
        {
          uri: 'api://broken',
          mimeType: 'application/json',
          text: '{invalid json}',
        },
      ],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    const pre = viewer.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe('{invalid json}');
  });

  it('handles multiple contents', () => {
    const data = {
      contents: [
        { uri: 'file:///a.txt', text: 'Content A' },
        { uri: 'file:///b.txt', text: 'Content B' },
        { uri: 'file:///c.txt', text: 'Content C' },
      ],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    expect(viewer.textContent).toContain('Content A');
    expect(viewer.textContent).toContain('Content B');
    expect(viewer.textContent).toContain('Content C');
    expect(viewer.textContent).toContain('file:///a.txt');
    expect(viewer.textContent).toContain('file:///b.txt');
    expect(viewer.textContent).toContain('file:///c.txt');
  });

  it('renders empty text when content.text is undefined', () => {
    const data = {
      contents: [{ uri: 'file:///empty.txt' }],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    expect(viewer.textContent).toContain('file:///empty.txt');
  });

  it('prioritizes loading over error', () => {
    const error = new Error('fail');

    const { getByTestId, queryByTestId } = render(<ResourceViewer data={null} loading={true} error={error} />);

    expect(getByTestId('resource-loading')).toBeTruthy();
    expect(queryByTestId('resource-error')).toBeNull();
  });

  it('prioritizes error over data', () => {
    const error = new Error('fail');
    const data = {
      contents: [{ uri: 'file:///a.txt', text: 'data' }],
    };

    const { getByTestId, queryByTestId } = render(<ResourceViewer data={data} error={error} />);

    expect(getByTestId('resource-error')).toBeTruthy();
    expect(queryByTestId('resource-viewer')).toBeNull();
  });

  it('renders JSON content with empty text as empty pre', () => {
    const data = {
      contents: [
        {
          uri: 'api://empty',
          mimeType: 'application/json',
        },
      ],
    };

    const { getByTestId } = render(<ResourceViewer data={data} />);

    const viewer = getByTestId('resource-viewer');
    const pre = viewer.querySelector('pre');
    expect(pre).not.toBeNull();
    // formatJson('') will fail to parse and return ''
    expect(pre?.textContent).toBe('');
  });
});
