/**
 * Mermaid Renderer Tests
 */

import { MermaidRenderer, isMermaid } from '../mermaid';

describe('MermaidRenderer', () => {
  const renderer = new MermaidRenderer();

  describe('isMermaid()', () => {
    it('should detect graph', () => {
      expect(isMermaid('graph TD\n  A-->B')).toBe(true);
    });

    it('should detect flowchart', () => {
      expect(isMermaid('flowchart LR\n  A-->B')).toBe(true);
    });

    it('should detect sequenceDiagram', () => {
      expect(isMermaid('sequenceDiagram\n  A->>B: Hello')).toBe(true);
    });

    it('should detect classDiagram', () => {
      expect(isMermaid('classDiagram\n  Class01 <|-- Class02')).toBe(true);
    });

    it('should detect stateDiagram', () => {
      expect(isMermaid('stateDiagram\n  [*] --> Active')).toBe(true);
    });

    it('should detect erDiagram', () => {
      expect(isMermaid('erDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe(true);
    });

    it('should detect gantt', () => {
      expect(isMermaid('gantt\n  title Schedule')).toBe(true);
    });

    it('should detect pie', () => {
      expect(isMermaid('pie\n  "Dogs" : 386')).toBe(true);
    });

    it('should detect journey', () => {
      expect(isMermaid('journey\n  title My Day')).toBe(true);
    });

    it('should detect gitGraph', () => {
      expect(isMermaid('gitGraph\n  commit')).toBe(true);
    });

    it('should handle leading whitespace', () => {
      expect(isMermaid('  graph TD\n    A-->B')).toBe(true);
    });

    it('should not detect non-mermaid', () => {
      expect(isMermaid('hello world')).toBe(false);
      expect(isMermaid('<div>HTML</div>')).toBe(false);
      expect(isMermaid('# Markdown')).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle mermaid diagrams', () => {
      expect(renderer.canHandle('graph TD\n  A-->B')).toBe(true);
    });

    it('should not handle non-mermaid', () => {
      expect(renderer.canHandle('hello world')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element', () => {
      const element = renderer.render('graph TD\n  A-->B');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('graph TD\n  A-->B');
      expect(element.props.className).toBe('fmcp-mermaid-content');
    });

    it('should use custom className', () => {
      const element = renderer.render('graph TD\n  A-->B', { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });

    it('should trim content', () => {
      const element = renderer.render('  graph TD\n  A-->B  ');
      expect(element.props.definition).toBe('graph TD\n  A-->B');
    });
  });

  describe('metadata', () => {
    it('should have type "mermaid"', () => {
      expect(renderer.type).toBe('mermaid');
    });

    it('should have priority 50', () => {
      expect(renderer.priority).toBe(50);
    });
  });
});
