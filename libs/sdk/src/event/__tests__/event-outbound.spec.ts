import { isEdgeRuntime } from '@frontmcp/utils';

import { eventOutboundTargetOptions } from '../event-outbound';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, isEdgeRuntime: jest.fn().mockReturnValue(false) };
});

describe('eventOutboundTargetOptions', () => {
  it('never lets the platform resolve DNS on Node', () => {
    expect(eventOutboundTargetOptions(false)).toEqual({ allowLocal: false });
    expect(eventOutboundTargetOptions(true)).toEqual({ allowLocal: true });
  });

  it('lets the platform resolve DNS on an edge runtime, which cannot pin it', () => {
    jest.mocked(isEdgeRuntime).mockReturnValue(true);

    expect(eventOutboundTargetOptions(false)).toEqual({ allowLocal: false, allowPlatformDns: true });
  });
});
