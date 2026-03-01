/**
 * Auto-detect and Registry Tests
 */

import {
  detectContentType,
  registerRenderer,
  renderContent,
  getRenderer,
  getRegisteredRenderers,
} from '../auto-detect';
import type { ContentRenderer } from '../types';
import React from 'react';

// ============================================
// detectContentType Tests
// ============================================

describe('detectContentType', () => {
  it('should detect PDF from header', () => {
    expect(detectContentType('%PDF-1.4 ...')).toBe('pdf');
  });

  it('should detect PDF from base64', () => {
    expect(detectContentType('JVBERi0xLjQK...')).toBe('pdf');
  });

  it('should detect PDF from data URI', () => {
    expect(detectContentType('data:application/pdf;base64,JVBERi0=')).toBe('pdf');
  });

  it('should detect CSV with commas', () => {
    expect(detectContentType('name,age,city\nAlice,30,NYC\nBob,25,LA')).toBe('csv');
  });

  it('should detect CSV with tabs', () => {
    expect(detectContentType('name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA')).toBe('csv');
  });

  it('should detect CSV with semicolons', () => {
    expect(detectContentType('name;age;city\nAlice;30;NYC\nBob;25;LA')).toBe('csv');
  });

  it('should not detect single-line as CSV', () => {
    expect(detectContentType('just a single line')).not.toBe('csv');
  });

  it('should detect chart JSON', () => {
    const chart = JSON.stringify({ type: 'bar', data: [{ name: 'A', value: 10 }] });
    expect(detectContentType(chart)).toBe('chart');
  });

  it('should detect flow JSON', () => {
    const flow = JSON.stringify({ nodes: [{ id: '1' }], edges: [{ source: '1', target: '2' }] });
    expect(detectContentType(flow)).toBe('flow');
  });

  it('should detect mermaid', () => {
    expect(detectContentType('graph TD\n  A-->B')).toBe('mermaid');
    expect(detectContentType('sequenceDiagram\n  A->>B: Hello')).toBe('mermaid');
    expect(detectContentType('flowchart LR\n  A-->B')).toBe('mermaid');
  });

  it('should detect math', () => {
    expect(detectContentType('$$E = mc^2$$')).toBe('math');
    expect(detectContentType('$x + y = z$')).toBe('math');
    expect(detectContentType('\\[\\frac{1}{2}\\]')).toBe('math');
    expect(detectContentType('\\begin{equation}x\\end{equation}')).toBe('math');
  });

  it('should detect map/GeoJSON', () => {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
    expect(detectContentType(geojson)).toBe('map');
  });

  it('should detect image data URI', () => {
    expect(detectContentType('data:image/png;base64,iVBOR...')).toBe('image');
  });

  it('should detect image URL', () => {
    expect(detectContentType('https://example.com/photo.jpg')).toBe('image');
    expect(detectContentType('https://example.com/photo.png')).toBe('image');
  });

  it('should detect video URL', () => {
    expect(detectContentType('https://example.com/video.mp4')).toBe('video');
    expect(detectContentType('https://www.youtube.com/watch?v=abc123')).toBe('video');
  });

  it('should detect audio URL', () => {
    expect(detectContentType('https://example.com/song.mp3')).toBe('audio');
    expect(detectContentType('https://www.soundcloud.com/artist/track')).toBe('audio');
  });

  it('should detect JSX', () => {
    expect(detectContentType('const App = () => <div>Hello</div>')).toBe('jsx');
  });

  it('should detect MDX/markdown', () => {
    expect(detectContentType('# Hello World\n\nSome **bold** text')).toBe('mdx');
  });

  it('should fallback to HTML', () => {
    expect(detectContentType('just plain text')).toBe('html');
    expect(detectContentType('')).toBe('html');
  });
});

// ============================================
// Registry Tests
// ============================================

describe('Renderer Registry', () => {
  const mockRenderer: ContentRenderer = {
    type: 'test-type',
    priority: 100,
    canHandle: (content: string) => content.startsWith('TEST:'),
    render: (content: string) => React.createElement('div', null, content),
  };

  it('should register and retrieve a renderer', () => {
    registerRenderer(mockRenderer);
    expect(getRenderer('test-type')).toBe(mockRenderer);
  });

  it('should include registered renderer in list', () => {
    const renderers = getRegisteredRenderers();
    expect(renderers).toContain(mockRenderer);
  });

  it('should sort renderers by priority (descending)', () => {
    const lowPriority: ContentRenderer = {
      type: 'low-pri',
      priority: 1,
      canHandle: () => false,
      render: () => React.createElement('span'),
    };
    registerRenderer(lowPriority);

    const renderers = getRegisteredRenderers();
    const testIdx = renderers.indexOf(mockRenderer);
    const lowIdx = renderers.indexOf(lowPriority);
    expect(testIdx).toBeLessThan(lowIdx);
  });

  it('should render content using canHandle match', () => {
    const result = renderContent('TEST: hello');
    expect(result).toBeTruthy();
    expect(result.props.children).toBe('TEST: hello');
  });
});
