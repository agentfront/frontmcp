import React from 'react';

import { useAuthFlow } from '@frontmcp/ui/auth';

export default function EsmLoginPage(): React.ReactElement {
  const { state } = useAuthFlow();
  return React.createElement('div', { 'data-testid': 'esm-login-root' }, `Sign in to ${state.clientId ?? 'the app'}`);
}
