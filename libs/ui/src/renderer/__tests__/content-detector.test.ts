/**
 * Content Detector Tests (runtime/content-detector.ts)
 */

import { detectContentType } from '../../runtime/content-detector';

describe('detectContentType (runtime)', () => {
  // Structured JSON types
  describe('chart detection', () => {
    it('should detect bar chart', () => {
      expect(detectContentType(JSON.stringify({ type: 'bar', data: [] }))).toBe('chart');
    });

    it('should detect line chart', () => {
      expect(detectContentType(JSON.stringify({ type: 'line', data: [] }))).toBe('chart');
    });
  });

  describe('flow detection', () => {
    it('should detect flow JSON', () => {
      expect(detectContentType(JSON.stringify({ nodes: [{ id: '1' }], edges: [{ source: '1', target: '2' }] }))).toBe(
        'flow',
      );
    });
  });

  describe('map detection', () => {
    it('should detect GeoJSON FeatureCollection', () => {
      expect(detectContentType(JSON.stringify({ type: 'FeatureCollection', features: [] }))).toBe('map');
    });

    it('should detect GeoJSON Feature', () => {
      expect(detectContentType(JSON.stringify({ type: 'Feature', geometry: {} }))).toBe('map');
    });
  });

  describe('mermaid detection', () => {
    it('should detect graph syntax', () => {
      expect(detectContentType('graph TD\n  A-->B')).toBe('mermaid');
    });

    it('should detect flowchart syntax', () => {
      expect(detectContentType('flowchart LR\n  A-->B')).toBe('mermaid');
    });

    it('should detect sequence diagram', () => {
      expect(detectContentType('sequenceDiagram\n  A->>B: Hello')).toBe('mermaid');
    });
  });

  describe('math detection', () => {
    it('should detect $$...$$', () => {
      expect(detectContentType('$$E = mc^2$$')).toBe('math');
    });

    it('should detect $...$', () => {
      expect(detectContentType('$x + y$')).toBe('math');
    });

    it('should detect \\[...\\]', () => {
      expect(detectContentType('\\[\\sum_{i=1}^{n} i\\]')).toBe('math');
    });

    it('should detect \\begin{equation}', () => {
      expect(detectContentType('\\begin{equation}x\\end{equation}')).toBe('math');
    });
  });

  describe('image detection', () => {
    it('should detect image data URI', () => {
      expect(detectContentType('data:image/png;base64,iVBOR')).toBe('image');
    });

    it('should detect image URL', () => {
      expect(detectContentType('https://example.com/photo.jpg')).toBe('image');
    });
  });

  describe('video detection', () => {
    it('should detect video URL', () => {
      expect(detectContentType('https://example.com/video.mp4')).toBe('video');
    });

    it('should detect YouTube URL', () => {
      expect(detectContentType('https://www.youtube.com/watch?v=abc123')).toBe('video');
    });
  });

  describe('audio detection', () => {
    it('should detect audio URL', () => {
      expect(detectContentType('https://example.com/song.mp3')).toBe('audio');
    });

    it('should detect SoundCloud URL', () => {
      expect(detectContentType('https://www.soundcloud.com/artist/track')).toBe('audio');
    });
  });

  describe('text type detection', () => {
    it('should detect JSX', () => {
      expect(detectContentType('const App = () => <div>Hello</div>')).toBe('jsx');
    });

    it('should detect MDX with multiple patterns', () => {
      expect(detectContentType('# Hello World\n\n- Item 1\n- Item 2')).toBe('mdx');
    });

    it('should fallback to HTML', () => {
      expect(detectContentType('just plain text')).toBe('html');
    });

    it('should return html for empty string', () => {
      expect(detectContentType('')).toBe('html');
    });

    it('should return html for non-string', () => {
      expect(detectContentType(null as unknown as string)).toBe('html');
      expect(detectContentType(undefined as unknown as string)).toBe('html');
    });
  });
});
