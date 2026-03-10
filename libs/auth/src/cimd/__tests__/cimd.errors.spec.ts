/**
 * CIMD Error Classes Tests
 *
 * Tests all error classes for instanceof checks, message formatting,
 * error codes, status codes, and getPublicMessage() behavior.
 */
import {
  CimdError,
  InvalidClientIdUrlError,
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdSecurityError,
  RedirectUriMismatchError,
  CimdResponseTooLargeError,
  CimdDisabledError,
} from '../cimd.errors';

// ============================================
// CimdError (abstract base - tested via subclasses)
// ============================================

describe('CimdError base class', () => {
  it('all subclasses should be instances of Error', () => {
    const errors = [
      new InvalidClientIdUrlError('https://example.com', 'test'),
      new CimdFetchError('https://example.com', 'test'),
      new CimdValidationError('https://example.com', ['err']),
      new CimdClientIdMismatchError('https://a.com', 'https://b.com'),
      new CimdSecurityError('https://example.com', 'test'),
      new RedirectUriMismatchError('https://example.com', 'https://bad.com', ['https://good.com']),
      new CimdResponseTooLargeError('https://example.com', 1024),
      new CimdDisabledError(),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CimdError);
    }
  });

  it('all subclasses should have correct name set to constructor name', () => {
    const error = new InvalidClientIdUrlError('https://example.com', 'test');
    expect(error.name).toBe('InvalidClientIdUrlError');

    const fetchError = new CimdFetchError('https://example.com', 'timeout');
    expect(fetchError.name).toBe('CimdFetchError');
  });

  it('subclasses should have stack traces', () => {
    const error = new InvalidClientIdUrlError('https://example.com', 'test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('InvalidClientIdUrlError');
  });
});

// ============================================
// InvalidClientIdUrlError
// ============================================

describe('InvalidClientIdUrlError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new InvalidClientIdUrlError('https://bad-url.com', 'must use HTTPS');
    expect(error.code).toBe('INVALID_CLIENT_ID_URL');
    expect(error.statusCode).toBe(400);
    expect(error.clientIdUrl).toBe('https://bad-url.com');
  });

  it('should store the reason', () => {
    const error = new InvalidClientIdUrlError('https://bad-url.com', 'missing path');
    expect(error.reason).toBe('missing path');
  });

  it('should format the internal message', () => {
    const error = new InvalidClientIdUrlError('https://bad-url.com', 'must use HTTPS');
    expect(error.message).toBe('Invalid CIMD client_id URL: must use HTTPS');
  });

  it('should format the public message', () => {
    const error = new InvalidClientIdUrlError('https://bad-url.com', 'must use HTTPS');
    expect(error.getPublicMessage()).toBe('Invalid client_id URL: must use HTTPS');
  });

  it('should be instanceof CimdError', () => {
    const error = new InvalidClientIdUrlError('https://bad-url.com', 'test');
    expect(error).toBeInstanceOf(CimdError);
  });
});

// ============================================
// CimdFetchError
// ============================================

describe('CimdFetchError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new CimdFetchError('https://example.com/client', 'connection refused');
    expect(error.code).toBe('CIMD_FETCH_ERROR');
    expect(error.statusCode).toBe(502);
    expect(error.clientIdUrl).toBe('https://example.com/client');
  });

  it('should format the internal message', () => {
    const error = new CimdFetchError('https://example.com/client', 'connection refused');
    expect(error.message).toBe('Failed to fetch CIMD document from https://example.com/client: connection refused');
  });

  it('should store optional httpStatus', () => {
    const error = new CimdFetchError('https://example.com/client', 'not found', { httpStatus: 404 });
    expect(error.httpStatus).toBe(404);
  });

  it('should store optional originalError', () => {
    const original = new Error('network error');
    const error = new CimdFetchError('https://example.com/client', 'network error', { originalError: original });
    expect(error.originalError).toBe(original);
  });

  it('should return HTTP status in public message when available', () => {
    const error = new CimdFetchError('https://example.com/client', 'not found', { httpStatus: 404 });
    expect(error.getPublicMessage()).toBe('Failed to fetch client metadata: HTTP 404');
  });

  it('should return generic public message when no HTTP status', () => {
    const error = new CimdFetchError('https://example.com/client', 'timeout');
    expect(error.getPublicMessage()).toBe('Failed to fetch client metadata document');
  });
});

// ============================================
// CimdValidationError
// ============================================

describe('CimdValidationError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new CimdValidationError('https://example.com/client', ['missing client_name']);
    expect(error.code).toBe('CIMD_VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.clientIdUrl).toBe('https://example.com/client');
  });

  it('should store validation errors array', () => {
    const errors = ['missing client_name', 'invalid redirect_uris'];
    const error = new CimdValidationError('https://example.com/client', errors);
    expect(error.validationErrors).toEqual(errors);
  });

  it('should format internal message with joined errors', () => {
    const error = new CimdValidationError('https://example.com/client', ['error1', 'error2']);
    expect(error.message).toBe('CIMD document validation failed: error1; error2');
  });

  it('should format public message with joined errors', () => {
    const error = new CimdValidationError('https://example.com/client', ['error1', 'error2']);
    expect(error.getPublicMessage()).toBe('Client metadata document validation failed: error1; error2');
  });

  it('should handle single validation error', () => {
    const error = new CimdValidationError('https://example.com/client', ['only error']);
    expect(error.message).toContain('only error');
    expect(error.getPublicMessage()).toContain('only error');
  });
});

// ============================================
// CimdClientIdMismatchError
// ============================================

describe('CimdClientIdMismatchError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new CimdClientIdMismatchError('https://url.com/client', 'https://other.com/client');
    expect(error.code).toBe('CIMD_CLIENT_ID_MISMATCH');
    expect(error.statusCode).toBe(400);
    expect(error.clientIdUrl).toBe('https://url.com/client');
  });

  it('should store the document client_id', () => {
    const error = new CimdClientIdMismatchError('https://url.com/client', 'https://other.com/client');
    expect(error.documentClientId).toBe('https://other.com/client');
  });

  it('should format internal message with both client IDs', () => {
    const error = new CimdClientIdMismatchError('https://url.com/client', 'https://other.com/client');
    expect(error.message).toBe(
      'CIMD client_id mismatch: URL is "https://url.com/client" but document contains "https://other.com/client"',
    );
  });

  it('should return generic public message', () => {
    const error = new CimdClientIdMismatchError('https://url.com/client', 'https://other.com/client');
    expect(error.getPublicMessage()).toBe('Client ID in metadata document does not match the request');
  });
});

// ============================================
// CimdSecurityError
// ============================================

describe('CimdSecurityError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new CimdSecurityError('https://192.168.1.1/client', 'private IP address');
    expect(error.code).toBe('CIMD_SECURITY_ERROR');
    expect(error.statusCode).toBe(403);
    expect(error.clientIdUrl).toBe('https://192.168.1.1/client');
  });

  it('should store the security reason', () => {
    const error = new CimdSecurityError('https://192.168.1.1/client', 'private IP address');
    expect(error.securityReason).toBe('private IP address');
  });

  it('should format internal message', () => {
    const error = new CimdSecurityError('https://192.168.1.1/client', 'private IP');
    expect(error.message).toBe('CIMD security check failed for https://192.168.1.1/client: private IP');
  });

  it('should return generic public message', () => {
    const error = new CimdSecurityError('https://192.168.1.1/client', 'private IP');
    expect(error.getPublicMessage()).toBe('Client ID URL is not allowed by security policy');
  });
});

// ============================================
// RedirectUriMismatchError
// ============================================

describe('RedirectUriMismatchError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new RedirectUriMismatchError('https://example.com/client', 'https://evil.com/callback', [
      'https://example.com/callback',
    ]);
    expect(error.code).toBe('REDIRECT_URI_MISMATCH');
    expect(error.statusCode).toBe(400);
    expect(error.clientIdUrl).toBe('https://example.com/client');
  });

  it('should store the requested redirect URI', () => {
    const error = new RedirectUriMismatchError('https://example.com/client', 'https://evil.com/callback', [
      'https://example.com/callback',
    ]);
    expect(error.requestedRedirectUri).toBe('https://evil.com/callback');
  });

  it('should store the allowed redirect URIs', () => {
    const allowed = ['https://example.com/callback', 'http://localhost:3000/callback'];
    const error = new RedirectUriMismatchError('https://example.com/client', 'https://evil.com/callback', allowed);
    expect(error.allowedRedirectUris).toEqual(allowed);
  });

  it('should format internal message', () => {
    const error = new RedirectUriMismatchError('https://example.com/client', 'https://evil.com/callback', []);
    expect(error.message).toBe(
      'Redirect URI "https://evil.com/callback" is not registered for client "https://example.com/client"',
    );
  });

  it('should return generic public message', () => {
    const error = new RedirectUriMismatchError('https://example.com/client', 'https://evil.com/callback', []);
    expect(error.getPublicMessage()).toBe('The redirect_uri is not registered for this client');
  });
});

// ============================================
// CimdResponseTooLargeError
// ============================================

describe('CimdResponseTooLargeError', () => {
  it('should store code, statusCode, and clientIdUrl', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536);
    expect(error.code).toBe('CIMD_RESPONSE_TOO_LARGE');
    expect(error.statusCode).toBe(502);
    expect(error.clientIdUrl).toBe('https://example.com/client');
  });

  it('should store maxBytes', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536);
    expect(error.maxBytes).toBe(65536);
  });

  it('should store optional actualBytes', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536, 131072);
    expect(error.actualBytes).toBe(131072);
  });

  it('should format internal message without actualBytes', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536);
    expect(error.message).toBe('CIMD response from https://example.com/client exceeds maximum size of 65536 bytes');
  });

  it('should format internal message with actualBytes', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536, 131072);
    expect(error.message).toBe(
      'CIMD response from https://example.com/client exceeds maximum size of 65536 bytes (received 131072 bytes)',
    );
  });

  it('should return generic public message', () => {
    const error = new CimdResponseTooLargeError('https://example.com/client', 65536);
    expect(error.getPublicMessage()).toBe('Client metadata document is too large');
  });
});

// ============================================
// CimdDisabledError
// ============================================

describe('CimdDisabledError', () => {
  it('should have correct code and statusCode', () => {
    const error = new CimdDisabledError();
    expect(error.code).toBe('CIMD_DISABLED');
    expect(error.statusCode).toBe(400);
  });

  it('should not have a clientIdUrl', () => {
    const error = new CimdDisabledError();
    expect(error.clientIdUrl).toBeUndefined();
  });

  it('should format internal message', () => {
    const error = new CimdDisabledError();
    expect(error.message).toBe('CIMD (Client ID Metadata Documents) is disabled on this server');
  });

  it('should use base class getPublicMessage (returns internal message)', () => {
    const error = new CimdDisabledError();
    expect(error.getPublicMessage()).toBe('CIMD (Client ID Metadata Documents) is disabled on this server');
  });

  it('should be instanceof CimdError and Error', () => {
    const error = new CimdDisabledError();
    expect(error).toBeInstanceOf(CimdError);
    expect(error).toBeInstanceOf(Error);
  });
});
