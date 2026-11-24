import { clientAuthMethodToRecord, meetsRecordedClientAuth } from '../grant-client-auth';

describe('meetsRecordedClientAuth', () => {
  it('lets any client redeem a grant recorded as public', () => {
    expect(meetsRecordedClientAuth('none', undefined)).toBe(true);
    expect(meetsRecordedClientAuth('none', 'none')).toBe(true);
    expect(meetsRecordedClientAuth('none', 'client_secret_post')).toBe(true);
  });

  it('keeps requiring client authentication for a grant recorded as confidential', () => {
    expect(meetsRecordedClientAuth('client_secret_post', 'client_secret_post')).toBe(true);
    expect(meetsRecordedClientAuth('client_secret_post', 'client_secret_basic')).toBe(true);
    expect(meetsRecordedClientAuth('client_secret_post', 'none')).toBe(false);
    expect(meetsRecordedClientAuth('client_secret_post', undefined)).toBe(false);
  });

  it('needs a known client for a grant recorded without a method', () => {
    expect(meetsRecordedClientAuth(undefined, 'none')).toBe(true);
    expect(meetsRecordedClientAuth(undefined, 'client_secret_basic')).toBe(true);
    expect(meetsRecordedClientAuth(undefined, undefined)).toBe(false);
  });
});

describe('clientAuthMethodToRecord', () => {
  it('keeps a confidential method, even once the client is registered as public', () => {
    expect(clientAuthMethodToRecord('client_secret_post', 'none')).toBe('client_secret_post');
  });

  it("takes the client's current method for a grant recorded as public or without a method", () => {
    expect(clientAuthMethodToRecord('none', 'client_secret_basic')).toBe('client_secret_basic');
    expect(clientAuthMethodToRecord(undefined, 'client_secret_basic')).toBe('client_secret_basic');
    expect(clientAuthMethodToRecord('none', undefined)).toBe('none');
  });
});
