import {
  AUTH_EXTRA_FIELD,
  AUTH_FLOW_GLOBAL_KEY,
  AUTH_WIRE_FIELDS,
  CONSENT_SUBMITTED_VALUE,
  DEFAULT_AUTH_MOUNT_ID,
  DEFAULT_SUBMIT_METHOD,
  WIRE_TRUE,
} from '../contract';

describe('auth/contract constants', () => {
  it('uses the documented injected-global key', () => {
    expect(AUTH_FLOW_GLOBAL_KEY).toBe('__FRONTMCP_AUTH__');
  });

  it('defaults the finish submit to GET (matching the callback round-trip)', () => {
    expect(DEFAULT_SUBMIT_METHOD).toBe('GET');
  });

  it('exposes the default SSR/hydration mount id', () => {
    expect(DEFAULT_AUTH_MOUNT_ID).toBe('frontmcp-auth-root');
  });

  it('maps wire fields to the exact params the callback flow reads', () => {
    expect(AUTH_WIRE_FIELDS.pendingAuthId).toBe('pending_auth_id');
    expect(AUTH_WIRE_FIELDS.csrf).toBe('csrf');
    expect(AUTH_WIRE_FIELDS.consentSubmitted).toBe('consent_submitted');
    expect(AUTH_WIRE_FIELDS.tools).toBe('tools');
    expect(AUTH_WIRE_FIELDS.providers).toBe('providers');
    expect(AUTH_WIRE_FIELDS.federated).toBe('federated');
    expect(AUTH_WIRE_FIELDS.incremental).toBe('incremental');
    expect(AUTH_WIRE_FIELDS.appId).toBe('app_id');
    expect(AUTH_WIRE_FIELDS.action).toBe('action');
  });

  it('routes extras through the action field by default', () => {
    expect(AUTH_EXTRA_FIELD).toBe('action');
  });

  it('exposes the marker literals the flow checks for', () => {
    expect(CONSENT_SUBMITTED_VALUE).toBe('1');
    expect(WIRE_TRUE).toBe('true');
  });
});
