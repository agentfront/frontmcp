/**
 * The X-FrontMCP-Machine-Id header is applied by a hookable `applyNodeHeaders`
 * stage that runs before any other stage, so every response of the streamable
 * (message, DELETE, GET) and stateless flows carries it.
 */

import HandleStatelessHttpFlow, { plan as statelessPlan } from '../handle.stateless-http.flow';
import HandleStreamableHttpFlow, { plan as streamablePlan } from '../handle.streamable-http.flow';

const mockRuntime = { deployment: 'distributed' };
jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  getRuntimeContext: () => mockRuntime,
  getMachineId: () => 'node-7',
}));

function runStage(flow: { prototype: { applyNodeHeaders: () => Promise<void> } }) {
  const headers = new Map<string, unknown>();
  const response = {
    setHeader: (k: string, v: unknown) => headers.set(k, v),
    getHeader: (k: string) => headers.get(k),
  };
  return flow.prototype.applyNodeHeaders.call({ rawInput: { response } }).then(() => headers);
}

describe('applyNodeHeaders stage', () => {
  afterEach(() => {
    mockRuntime.deployment = 'distributed';
  });

  it.each([
    ['streamable-http', streamablePlan],
    ['stateless-http', statelessPlan],
  ])('%s runs applyNodeHeaders first', (_name, plan) => {
    expect(plan.pre[0]).toBe('applyNodeHeaders');
  });

  it.each([
    ['streamable-http', HandleStreamableHttpFlow],
    ['stateless-http', HandleStatelessHttpFlow],
  ])('%s sets the machine id header in distributed mode', async (_name, flow) => {
    const headers = await runStage(flow as never);
    expect(headers.get('X-FrontMCP-Machine-Id')).toBe('node-7');
  });

  it('sets nothing outside distributed mode', async () => {
    mockRuntime.deployment = 'standalone';
    const headers = await runStage(HandleStreamableHttpFlow as never);
    expect(headers.size).toBe(0);
  });
});
