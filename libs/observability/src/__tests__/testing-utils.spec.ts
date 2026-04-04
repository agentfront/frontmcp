import {
  createTestTracer,
  getFinishedSpans,
  assertSpanExists,
  assertSpanAttribute,
  findSpan,
  findSpansByAttribute,
} from '../testing';

describe('Testing Utilities', () => {
  describe('createTestTracer', () => {
    it('should create a tracer with in-memory exporter', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();
      expect(tracer).toBeTruthy();
      expect(exporter).toBeTruthy();

      const span = tracer.startSpan('test');
      span.end();

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('test');

      await cleanup();
    });

    it('should accept a custom tracer name', async () => {
      const { cleanup } = createTestTracer('my-tracer');
      await cleanup();
    });
  });

  describe('getFinishedSpans', () => {
    it('should return spans from exporter', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      tracer.startSpan('span1').end();
      tracer.startSpan('span2').end();

      const spans = getFinishedSpans(exporter);
      expect(spans).toHaveLength(2);

      await cleanup();
    });
  });

  describe('assertSpanExists', () => {
    it('should return the matching span', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      tracer.startSpan('tool get_weather').end();
      const spans = getFinishedSpans(exporter);

      const span = assertSpanExists(spans, 'tool get_weather');
      expect(span.name).toBe('tool get_weather');

      await cleanup();
    });

    it('should throw when span not found', () => {
      expect(() => assertSpanExists([], 'missing')).toThrow('Expected span "missing"');
    });

    it('should list available spans in error message', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();
      tracer.startSpan('foo').end();
      tracer.startSpan('bar').end();

      const spans = getFinishedSpans(exporter);
      expect(() => assertSpanExists(spans, 'missing')).toThrow('foo, bar');

      await cleanup();
    });
  });

  describe('assertSpanAttribute', () => {
    it('should pass for matching attribute', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      const span = tracer.startSpan('test', { attributes: { key: 'value' } });
      span.end();

      const spans = getFinishedSpans(exporter);
      assertSpanAttribute(spans[0], 'key', 'value');

      await cleanup();
    });

    it('should throw for non-matching attribute', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      const span = tracer.startSpan('test', { attributes: { key: 'actual' } });
      span.end();

      const spans = getFinishedSpans(exporter);
      expect(() => assertSpanAttribute(spans[0], 'key', 'expected')).toThrow(
        'Expected span "test" attribute "key" to be "expected" but got "actual"',
      );

      await cleanup();
    });
  });

  describe('findSpan', () => {
    it('should find span by name', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      tracer.startSpan('target').end();
      tracer.startSpan('other').end();

      const spans = getFinishedSpans(exporter);
      expect(findSpan(spans, 'target')?.name).toBe('target');
      expect(findSpan(spans, 'missing')).toBeUndefined();

      await cleanup();
    });
  });

  describe('findSpansByAttribute', () => {
    it('should find all spans with matching attribute', async () => {
      const { tracer, exporter, cleanup } = createTestTracer();

      tracer.startSpan('a', { attributes: { type: 'tool' } }).end();
      tracer.startSpan('b', { attributes: { type: 'tool' } }).end();
      tracer.startSpan('c', { attributes: { type: 'resource' } }).end();

      const spans = getFinishedSpans(exporter);
      const tools = findSpansByAttribute(spans, 'type', 'tool');
      expect(tools).toHaveLength(2);

      await cleanup();
    });
  });
});
