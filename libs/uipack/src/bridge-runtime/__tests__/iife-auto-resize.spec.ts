/**
 * @jest-environment jsdom
 */
/**
 * Auto-resize in an MCP Apps (ext-apps) host (#649).
 *
 * The observer starts in the same tick the `ui/initialize` handshake is posted,
 * so the first report runs on the next animation frame — before the host has
 * answered. These specs run the generated bridge (minified, as the shell ships
 * it, and unminified) in a jsdom iframe and check that:
 *
 * - the first report is held until the handshake completes, then sent;
 * - a report the host rejected is sent again for the same height;
 * - a manual `FrontMcpBridge.setSize` made before the handshake is delivered after it;
 * - the height comes from the whole document (`<html>` at `fit-content`), so body
 *   margins and collapsed child margins count, and `max-height` on `<html>` clamps it.
 *
 * jsdom has no layout, so the harness stubs the boxes and these specs assert the
 * computation rather than real rendering.
 */
import { createBridgeFrame, HOST_ORIGIN, type BridgeFrame, type StubLayout } from './bridge-frame';

const SIZE_NOTIFICATION = 'ui/notifications/size-changed';
const HANDSHAKE_RESULT = { hostCapabilities: {}, hostContext: {} };

function sizeRequests(frame: BridgeFrame) {
  return frame.notifications(SIZE_NOTIFICATION);
}

describe.each([
  ['minified', true],
  ['unminified', false],
])('bridge auto-resize (%s)', (_label, minify) => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  function open(sizing: Record<string, unknown>, layout?: StubLayout, bodyHtml = '<div id="root"></div>') {
    frame = createBridgeFrame({ sizing, layout, bodyHtml, minify });
    return frame;
  }

  describe('first report and the handshake', () => {
    it('holds the first report until the host answers ui/initialize, then sends it', async () => {
      const f = open({ autoResize: true });
      await f.settle();
      expect(f.requests('ui/initialize')).toHaveLength(1);

      // First animation frame runs before the host answers.
      f.flushFrames();
      await f.settle();
      expect(sizeRequests(f)).toHaveLength(0);

      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      const sent = sizeRequests(f);
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toMatchObject({ height: 120 });
      expect(window.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ method: SIZE_NOTIFICATION }),
        HOST_ORIGIN,
      );
    });

    it('reports the size with the standard notification, not the FrontMCP-only ui/setSize request', async () => {
      const f = open({ autoResize: true });
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      const sent = sizeRequests(f);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({
        jsonrpc: '2.0',
        method: SIZE_NOTIFICATION,
        params: { width: expect.any(Number), height: 120 },
      });
      expect(f.posted.filter((m) => m.method === 'ui/setSize')).toHaveLength(0);
      expect(f.requests(SIZE_NOTIFICATION)).toHaveLength(0);
    });

    it('does not send an unchanged height again after a successful report', async () => {
      const f = open({ autoResize: true });
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      f.triggerResize();
      f.flushFrames();
      await f.settle();
      expect(sizeRequests(f)).toHaveLength(1);
    });

    it('delivers a manual setSize made before the handshake once it completes', async () => {
      const f = open({ autoResize: false });
      await f.settle();

      const first = f.bridge.setSize({ height: 200 });
      const latest = f.bridge.setSize({ height: 300, width: 500 });
      await f.settle();
      expect(sizeRequests(f)).toHaveLength(0);

      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      const sent = sizeRequests(f);
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toMatchObject({ height: 300, width: 500 });

      await f.settle();
      await expect(first).resolves.toBeUndefined();
      await expect(latest).resolves.toBeUndefined();
    });

    it('sends a queued setSize after a failed handshake', async () => {
      const f = open({ autoResize: false });
      await f.settle();
      // The promise comes from the frame's realm, so read its outcome as a string.
      const outcome = f.bridge.setSize({ height: 300 }).then(
        () => 'resolved',
        (err: { message?: string }) => `rejected: ${err.message}`,
      );
      await f.fail('ui/initialize', 'Unsupported');

      // The error response still establishes the host origin, so the queued size is sent.
      const sent = sizeRequests(f);
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toMatchObject({ height: 300 });
      await expect(outcome).resolves.toBe('resolved');
    });
  });

  describe('what is measured', () => {
    it('measures <html> at fit-content, so body margins and collapsed child margins count', async () => {
      // body at top 16 (its margin, or an <h2> margin collapsed through it), 16 more below.
      const layout: StubLayout = {
        html: (inlineHeight) => ({ top: 0, height: inlineHeight === 'fit-content' ? 152 : 600 }),
        body: { top: 16, height: 120 },
        bodyScrollHeight: 120,
        root: { top: 16, height: 120 },
      };
      const f = open({ autoResize: true }, layout);
      f.doc.documentElement.style.height = '100%';
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      expect(sizeRequests(f)[0].params).toMatchObject({ height: 152 });
      // The temporary fit-content height is undone.
      expect(f.doc.documentElement.style.height).toBe('100%');
    });

    it('counts content that overflows a fixed-height body', async () => {
      const layout: StubLayout = {
        html: () => ({ top: 0, height: 200 }),
        body: { top: 0, height: 200 },
        bodyScrollHeight: 400,
      };
      const f = open({ autoResize: true, preferredHeight: 200 }, layout);
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      expect(sizeRequests(f)[0].params).toMatchObject({ height: 400 });
    });

    it('clamps the report to the max-height set on <html>', async () => {
      const layout: StubLayout = {
        html: () => ({ top: 0, height: 250 }),
        body: { top: 0, height: 250 },
        bodyScrollHeight: 400,
      };
      const f = open({ autoResize: true, maxHeight: 250 }, layout);
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      expect(f.doc.documentElement.style.maxHeight).toBe('250px');
      expect(sizeRequests(f)[0].params).toMatchObject({ height: 250 });
    });

    it('does not clamp to a max-height that is not in px', async () => {
      const layout: StubLayout = {
        html: () => ({ top: 0, height: 120 }),
        body: { top: 0, height: 120 },
        bodyScrollHeight: 400,
      };
      const f = open({ autoResize: true, maxHeight: '50%' }, layout);
      await f.settle();
      await f.answer('ui/initialize', HANDSHAKE_RESULT);
      f.flushFrames();
      await f.settle();

      expect(sizeRequests(f)[0].params).toMatchObject({ height: 400 });
    });

    it('observes <html>, <body> and #root', async () => {
      const f = open({ autoResize: true });
      await f.settle();
      const root = f.doc.getElementById('root');
      expect(f.observed).toEqual(expect.arrayContaining([f.doc.documentElement, f.doc.body, root]));
    });

    it('observes <html> and <body> when there is no #root', async () => {
      const f = open({ autoResize: true }, undefined, '<p>plain</p>');
      await f.settle();
      expect(f.observed).toEqual([f.doc.documentElement, f.doc.body]);
    });
  });
});
