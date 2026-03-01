/**
 * Flow Renderer Tests
 */

import { FlowRenderer, isFlow } from '../flow';

describe('FlowRenderer', () => {
  const renderer = new FlowRenderer();

  const validFlow = JSON.stringify({
    nodes: [
      { id: '1', data: { label: 'Node 1' }, position: { x: 0, y: 0 } },
      { id: '2', data: { label: 'Node 2' }, position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2' }],
  });

  describe('isFlow()', () => {
    it('should detect valid flow JSON', () => {
      expect(isFlow(validFlow)).toBe(true);
    });

    it('should detect flow with additional properties', () => {
      const flow = JSON.stringify({
        nodes: [{ id: '1' }],
        edges: [{ source: '1', target: '2' }],
        fitView: true,
      });
      expect(isFlow(flow)).toBe(true);
    });

    it('should not detect non-flow JSON', () => {
      expect(isFlow(JSON.stringify({ type: 'bar', data: [] }))).toBe(false);
    });

    it('should not detect plain text', () => {
      expect(isFlow('hello world')).toBe(false);
    });

    it('should not detect JSON without edges', () => {
      expect(isFlow(JSON.stringify({ nodes: [{ id: '1' }] }))).toBe(false);
    });
  });

  describe('canHandle()', () => {
    it('should handle valid flow JSON', () => {
      expect(renderer.canHandle(validFlow)).toBe(true);
    });

    it('should not handle non-flow', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });
  });

  describe('render()', () => {
    it('should return a React element for valid JSON', () => {
      const element = renderer.render(validFlow);
      expect(element).toBeTruthy();
    });

    it('should return error for invalid JSON', () => {
      const element = renderer.render('invalid json');
      expect(element).toBeTruthy();
      expect(element.props.severity).toBe('error');
    });

    it('should use default className', () => {
      const element = renderer.render(validFlow);
      expect(element.props.className).toBe('fmcp-flow-content');
    });

    it('should use custom className', () => {
      const element = renderer.render(validFlow, { className: 'custom' });
      expect(element.props.className).toBe('custom');
    });
  });

  describe('metadata', () => {
    it('should have type "flow"', () => {
      expect(renderer.type).toBe('flow');
    });

    it('should have priority 70', () => {
      expect(renderer.priority).toBe(70);
    });
  });
});
