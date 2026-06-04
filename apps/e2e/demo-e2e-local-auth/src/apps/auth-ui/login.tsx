/**
 * Custom `auth.ui.login` component for the auth-UI E2E.
 *
 * Uses the `@frontmcp/ui/auth` hooks to read the server-injected
 * {@link AuthFlowState} and render a sign-in form. The enclosing `<form>` (with
 * the `pending_auth_id` + `csrf` hidden fields) is supplied by `AuthPageWrapper`,
 * so this component only adds the visible fields + an auth-extra add-row.
 */
import React from 'react';

import { useAddedItems, useAuthFlow } from '@frontmcp/ui/auth';

export default function CustomLoginPage(): React.ReactElement {
  const { state } = useAuthFlow();
  const envs = useAddedItems('envs:add');

  return React.createElement(
    'div',
    { className: 'custom-login', 'data-testid': 'custom-login-root' },
    React.createElement('h1', null, 'Custom Branded Sign In'),
    React.createElement(
      'p',
      { 'data-client-name': state.clientName },
      `Authorize ${state.clientName ?? state.clientId ?? 'the app'}`,
    ),
    React.createElement('label', null, 'Email'),
    React.createElement('input', { type: 'email', name: 'email', placeholder: 'you@example.com' }),
    React.createElement('button', { type: 'submit' }, 'Sign In'),
    // Surface the auth-extra accumulator so the test can see added items reflected.
    React.createElement(
      'ul',
      { 'data-testid': 'env-list' },
      envs.map((e, i) => React.createElement('li', { key: i }, JSON.stringify(e))),
    ),
  );
}
