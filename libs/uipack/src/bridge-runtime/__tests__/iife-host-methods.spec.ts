/**
 * @jest-environment jsdom
 */
/**
 * The requests a widget sends an MCP Apps host use the spec's method names and params:
 * `ui/open-link`, `ui/update-model-context` and the standard MCP `notifications/message`.
 */
import { createBridgeFrame, type BridgeFrame } from './bridge-frame';

describe('bridge requests to an MCP Apps host', () => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  async function connect(hostCapabilities: Record<string, unknown>): Promise<BridgeFrame> {
    const connected = createBridgeFrame();
    await connected.settle();
    await connected.answer('ui/initialize', { hostCapabilities, hostContext: {} });
    return connected;
  }

  it('opens a link with ui/open-link', async () => {
    frame = await connect({ openLinks: {} });

    void frame.bridge.openLink('https://example.com/docs');
    await frame.settle();

    expect(frame.requests('ui/open-link').map((request) => request.params)).toEqual([
      { url: 'https://example.com/docs' },
    ]);
  });

  it('still opens a link through a host that advertises the earlier openLink capability', async () => {
    frame = await connect({ openLink: true });

    void frame.bridge.openLink('https://example.com/docs');
    await frame.settle();

    expect(frame.requests('ui/open-link')).toHaveLength(1);
  });

  it('sends model context as ui/update-model-context content and structuredContent, merging updates', async () => {
    frame = await connect({ updateModelContext: { text: {} } });

    void frame.bridge.updateModelContext({ city: 'Oslo' });
    await frame.settle();
    void frame.bridge.updateModelContext({ unit: 'C' });
    await frame.settle();
    void frame.bridge.updateModelContext({ city: 'Bergen' }, false);
    await frame.settle();

    expect(frame.requests('ui/update-model-context').map((request) => request.params)).toEqual([
      { content: [{ type: 'text', text: '{"city":"Oslo"}' }], structuredContent: { city: 'Oslo' } },
      {
        content: [{ type: 'text', text: '{"city":"Oslo","unit":"C"}' }],
        structuredContent: { city: 'Oslo', unit: 'C' },
      },
      { content: [{ type: 'text', text: '{"city":"Bergen"}' }], structuredContent: { city: 'Bergen' } },
    ]);
  });

  it('sends text model context as a text block only', async () => {
    frame = await connect({ updateModelContext: { text: {} } });

    void frame.bridge.updateModelContext('The user picked Oslo');
    await frame.settle();

    expect(frame.requests('ui/update-model-context').map((request) => request.params)).toEqual([
      { content: [{ type: 'text', text: 'The user picked Oslo' }] },
    ]);
  });

  it('logs with a notifications/message notification at the MCP level', async () => {
    frame = await connect({ logging: {} });

    await frame.bridge.log('warn', 'Quota low', { remaining: 3 });
    await frame.bridge.log('info', 'Loaded');

    expect(frame.notifications('notifications/message').map((notification) => notification.params)).toEqual([
      { level: 'warning', data: { message: 'Quota low', data: { remaining: 3 } } },
      { level: 'info', data: 'Loaded' },
    ]);
  });

  it('sends none of the earlier method names', async () => {
    frame = await connect({ openLinks: {}, updateModelContext: { text: {} }, logging: {} });

    void frame.bridge.openLink('https://example.com');
    void frame.bridge.updateModelContext({ a: 1 });
    void frame.bridge.log('info', 'hi');
    await frame.settle();

    const methods = frame.posted.map((message) => message.method);
    expect(methods).not.toContain('ui/openLink');
    expect(methods).not.toContain('ui/updateModelContext');
    expect(methods).not.toContain('ui/log');
  });
});
