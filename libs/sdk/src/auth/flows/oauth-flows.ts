import { deferredFlow } from '../../flows/deferred-flow';

/** The OAuth flows, in route order. Each is registered by name and route, and loads with its first request. */
export const oauthFlows = [
  deferredFlow({ name: 'oauth:authorize', middleware: { method: 'GET', path: '/oauth/authorize' } }, () =>
    import('./oauth.authorize.flow.js').then((flow) => flow.OauthAuthorizeFlow),
  ),
  deferredFlow({ name: 'oauth:token', middleware: { method: 'POST', path: '/oauth/token' } }, () =>
    import('./oauth.token.flow.js').then((flow) => flow.OauthTokenFlow),
  ),
  deferredFlow({ name: 'oauth:userinfo', middleware: { method: 'GET', path: '/oauth/userinfo' } }, () =>
    import('./oauth.userinfo.flow.js').then((flow) => flow.OauthUserInfoFlow),
  ),
  deferredFlow({ name: 'oauth:callback', middleware: { path: '/oauth/callback' } }, () =>
    import('./oauth.callback.flow.js').then((flow) => flow.OauthCallbackFlow),
  ),
  deferredFlow({ name: 'oauth:connect', middleware: { path: '/oauth/connect' } }, () =>
    import('./oauth.connect.flow.js').then((flow) => flow.OauthConnectFlow),
  ),
  deferredFlow({ name: 'oauth:register', middleware: { method: 'POST', path: '/oauth/register' } }, () =>
    import('./oauth.register.flow.js').then((flow) => flow.OauthRegisterFlow),
  ),
  deferredFlow({ name: 'oauth:provider-callback', middleware: { path: '/oauth/provider/:providerId/callback' } }, () =>
    import('./oauth.provider-callback.flow.js').then((flow) => flow.OauthProviderCallbackFlow),
  ),
  deferredFlow({ name: 'oauth:auth-ui-extra', middleware: { method: 'POST', path: '/oauth/ui/extra' } }, () =>
    import('./oauth.auth-ui.flow.js').then((flow) => flow.OauthAuthUiExtraFlow),
  ),
];
