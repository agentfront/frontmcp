import { WIDGET_CALL_META_KEY as BRIDGE_WIDGET_CALL_META_KEY } from '@frontmcp/uipack/bridge-runtime';

import { WIDGET_CALL_META_KEY } from '../ui-shared';

describe('WIDGET_CALL_META_KEY', () => {
  it('names the key the widget bridge sets on its own tools/call', () => {
    expect(WIDGET_CALL_META_KEY).toBe(BRIDGE_WIDGET_CALL_META_KEY);
  });
});
