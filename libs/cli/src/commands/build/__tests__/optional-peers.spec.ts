import { detectOptionalPeers } from '../optional-peers';

const PROJECT_WITH_PEERS = '/projects/with-observability';
const PROJECT_WITHOUT_PEERS = '/projects/bare';

jest.mock('module', () => ({
  ...jest.requireActual('module'),
  createRequire: (from: string) => ({
    resolve: (moduleName: string) => {
      if (from.startsWith('/projects/bare')) throw new Error(`Cannot find module '${moduleName}'`);
      return `${from}/node_modules/${moduleName}/index.js`;
    },
  }),
}));

describe('detectOptionalPeers (#768)', () => {
  it('needs @frontmcp/observability when metrics are enabled', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: { metrics: { enabled: true } }, keysSeenInSource: ['metrics'] },
      PROJECT_WITH_PEERS,
    );
    expect(detection).toEqual({ installed: ['@frontmcp/observability'], missing: [] });
  });

  it('needs @frontmcp/observability when observability is configured', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: { observability: true }, keysSeenInSource: ['observability'] },
      PROJECT_WITH_PEERS,
    );
    expect(detection.installed).toEqual(['@frontmcp/observability']);
  });

  it('bundles the peer for an env-gated metrics block that evaluated to undefined at build time', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: { info: {} }, keysSeenInSource: ['info', 'metrics'] },
      PROJECT_WITH_PEERS,
    );
    expect(detection).toEqual({ installed: ['@frontmcp/observability'], missing: [] });
  });

  it('does not report the peer missing when the source names metrics but the evaluated config leaves them off', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: { metrics: { enabled: false } }, keysSeenInSource: ['metrics'] },
      PROJECT_WITHOUT_PEERS,
    );
    expect(detection).toEqual({ installed: [], missing: [] });
  });

  it('needs nothing when the source never names metrics or observability', () => {
    const detection = detectOptionalPeers({ decoratorConfig: { info: {} }, keysSeenInSource: ['info'] }, PROJECT_WITH_PEERS);
    expect(detection).toEqual({ installed: [], missing: [] });
  });

  it('falls back to the source scan when the entry could not be evaluated', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: undefined, keysSeenInSource: ['metrics'] },
      PROJECT_WITH_PEERS,
    );
    expect(detection.installed).toEqual(['@frontmcp/observability']);
  });

  it('reports the peer as missing when the project cannot resolve it', () => {
    const detection = detectOptionalPeers(
      { decoratorConfig: { metrics: { enabled: true } }, keysSeenInSource: [] },
      PROJECT_WITHOUT_PEERS,
    );
    expect(detection).toEqual({ installed: [], missing: ['@frontmcp/observability'] });
  });
});
