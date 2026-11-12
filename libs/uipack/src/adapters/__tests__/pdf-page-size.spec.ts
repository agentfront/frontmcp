/**
 * The PDF viewer page draws each page on a bounded canvas and stops drawing pages once the document
 * has used its pixel budget, however large the pages the document declares.
 */
import { buildPdfHtml } from '../content-renderers';

interface FakeElement {
  tag: string;
  width?: number;
  height?: number;
  textContent?: string;
  style: Record<string, string>;
  getContext?: () => object;
}

/** Run the viewer page's module script against a fake PDF.js whose pages all have the given size in points. */
async function drawPages(pageCount: number, pageWidth: number, pageHeight: number): Promise<FakeElement[]> {
  const html = buildPdfHtml('JVBERi0=');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const body = script.replace(/^import .*$/m, '');
  const drawn: FakeElement[] = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: pageWidth * scale, height: pageHeight * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({ numPages: pageCount, getPage: async () => page }) }),
  };
  const document = {
    getElementById: () => ({ appendChild: (element: FakeElement) => drawn.push(element) }),
    createElement: (tag: string): FakeElement => ({ tag, style: {}, getContext: () => ({}) }),
  };
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  await new AsyncFunction('pdfjsLib', 'document', 'atob', body)(pdfjsLib, document, () => '%PDF');
  return drawn;
}

describe('buildPdfHtml page drawing', () => {
  it('draws a letter-size page at one and a half times its size', async () => {
    const [canvas] = await drawPages(1, 612, 792);

    expect(canvas).toMatchObject({ tag: 'canvas', width: 918, height: 1188 });
  });

  it('scales a page declared 14400 points square down to 16M pixels', async () => {
    const [canvas] = await drawPages(1, 14400, 14400);

    expect((canvas.width ?? 0) * (canvas.height ?? 0)).toBeLessThanOrEqual(2 ** 24);
  });

  it('stops drawing once the document has used 128M pixels, and says which pages are not shown', async () => {
    const drawn = await drawPages(100, 14400, 14400);
    const canvases = drawn.filter((element) => element.tag === 'canvas');
    const pixels = canvases.reduce((total, canvas) => total + (canvas.width ?? 0) * (canvas.height ?? 0), 0);

    expect(canvases).toHaveLength(8);
    expect(pixels).toBeLessThanOrEqual(2 ** 27);
    expect(drawn[drawn.length - 1]).toMatchObject({
      tag: 'p',
      textContent: 'Pages 9 to 100 are not shown: the document is too large to draw.',
    });
  });
});
