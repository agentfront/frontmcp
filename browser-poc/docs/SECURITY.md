# Security Guide

Security considerations and best practices for FrontMCP Browser.

## Overview

FrontMCP Browser runs MCP servers directly in the browser, which introduces unique security considerations compared to server-side deployments. This guide covers:

- [Origin Validation](#origin-validation)
- [Message Integrity](#message-integrity)
- [CSRF Protection](#csrf-protection)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [PII Filtering](#pii-filtering)
- [XSS Prevention](#xss-prevention)
- [Authentication Patterns](#authentication-patterns)
- [Rate Limiting](#rate-limiting)
- [Store Authorization](#store-authorization)
- [Content Security Policy](#content-security-policy)
- [WebWorker Sandboxing](#webworker-sandboxing)
- [Iframe Sandboxing](#iframe-sandboxing)
- [Human-in-the-Loop (HiTL)](#human-in-the-loop-hitl)
- [Threat Model](#threat-model)

---

## Origin Validation

### The Problem

PostMessageTransport uses `window.postMessage()` which can receive messages from any origin by default. This is a **critical security risk** that can lead to:

- Cross-site scripting (XSS) attacks
- Data exfiltration
- Unauthorized command execution

### Configuration

**NEVER use the default `'*'` origin in production:**

```typescript
// DANGEROUS - accepts messages from any origin
const transport = new PostMessageTransport(window.parent, {
  origin: '*', // DO NOT USE IN PRODUCTION
});

// SECURE - only accepts messages from specific origin
const transport = new PostMessageTransport(window.parent, {
  origin: 'https://trusted-app.example.com',
});
```

### Best Practices

1. **Always specify explicit origins** - List only trusted domains
2. **Validate origin on every message** - Don't trust message content alone
3. **Use strict origin matching** - Avoid wildcards and partial matches
4. **Log origin violations** - Monitor for attack attempts

### Implementation Pattern

```typescript
interface SecurePostMessageTransportOptions {
  target: Worker | Window | MessagePort;
  allowedOrigins: string[]; // Required, no default
  onOriginViolation?: (origin: string) => void;
}

class SecurePostMessageTransport implements BrowserTransport {
  constructor(options: SecurePostMessageTransportOptions) {
    if (!options.allowedOrigins?.length) {
      throw new Error('allowedOrigins is required for PostMessageTransport');
    }
  }

  private handleMessage = (event: MessageEvent) => {
    if (!this.allowedOrigins.includes(event.origin)) {
      this.options.onOriginViolation?.(event.origin);
      console.warn(`Rejected message from untrusted origin: ${event.origin}`);
      return;
    }
    // Process message...
  };
}
```

---

## Message Integrity

### The Problem

JSON-RPC messages are transmitted without integrity verification. A man-in-the-middle (MITM) or compromised iframe could:

- Modify message content
- Replay old messages
- Inject malicious commands

### HMAC Message Signing (REQUIRED for Production)

**⚠️ PRODUCTION REQUIREMENT**

Message signing is **REQUIRED** for any production deployment where:

- MCP server handles sensitive data
- PostMessageTransport communicates across window boundaries
- AI agents can trigger state mutations or external actions

Message signing may be skipped **only** in development environments with same-origin EventTransport.

**Production Deployment Checklist:**

- [ ] HMAC signing enabled on all PostMessageTransport instances
- [ ] HMAC verification on every incoming message
- [ ] Replay attack prevention via nonce tracking enabled
- [ ] Key rotation policy defined (recommended: 90 days)

Implement message signing:

```typescript
interface SignedMessage {
  payload: JSONRPCMessage;
  timestamp: number;
  nonce: string;
  signature: string;
}

async function signMessage(message: JSONRPCMessage, secretKey: CryptoKey): Promise<SignedMessage> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const data = JSON.stringify({ payload: message, timestamp, nonce });

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(data));

  return {
    payload: message,
    timestamp,
    nonce,
    signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
  };
}

async function verifyMessage(
  signed: SignedMessage,
  secretKey: CryptoKey,
  maxAge: number = 30000, // 30 seconds
): Promise<boolean> {
  // Check timestamp freshness
  if (Date.now() - signed.timestamp > maxAge) {
    return false;
  }

  // Verify signature
  const data = JSON.stringify({
    payload: signed.payload,
    timestamp: signed.timestamp,
    nonce: signed.nonce,
  });

  const encoder = new TextEncoder();
  return crypto.subtle.verify(
    'HMAC',
    secretKey,
    Uint8Array.from(atob(signed.signature), (c) => c.charCodeAt(0)),
    encoder.encode(data),
  );
}
```

### Replay Prevention

Track seen nonces to prevent replay attacks:

```typescript
class NonceTracker {
  private seen = new Map<string, number>();
  private cleanupInterval: number;

  constructor(maxAge: number = 60000) {
    // Cleanup old nonces every minute
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - maxAge;
      for (const [nonce, timestamp] of this.seen) {
        if (timestamp < cutoff) this.seen.delete(nonce);
      }
    }, 60000);
  }

  check(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, Date.now());
    return true;
  }

  dispose() {
    clearInterval(this.cleanupInterval);
  }
}
```

---

## CSRF Protection

### The Problem

Cross-Site Request Forgery (CSRF) attacks exploit authenticated sessions to execute unauthorized actions. In browser MCP contexts, this is particularly dangerous because:

- Tool calls can trigger state mutations
- AI agents may execute actions on behalf of users
- PostMessage-based communication can be exploited

### CSRF Token Pattern

Implement CSRF tokens for sensitive tool operations:

```typescript
interface CSRFProtectedRequest {
  method: string;
  params: unknown;
  csrfToken: string;
}

class CSRFProtection {
  private token: string;
  private readonly tokenLifetime = 3600000; // 1 hour
  private tokenCreatedAt: number;

  constructor() {
    this.regenerateToken();
  }

  regenerateToken(): string {
    this.token = crypto.randomUUID();
    this.tokenCreatedAt = Date.now();
    return this.token;
  }

  getToken(): string {
    // Auto-regenerate if expired
    if (Date.now() - this.tokenCreatedAt > this.tokenLifetime) {
      this.regenerateToken();
    }
    return this.token;
  }

  validate(token: string): boolean {
    if (Date.now() - this.tokenCreatedAt > this.tokenLifetime) {
      return false; // Token expired
    }
    return token === this.token;
  }
}

// Usage in MCP transport
class CSRFProtectedTransport implements BrowserTransport {
  private csrf = new CSRFProtection();

  async callTool(name: string, args: unknown): Promise<unknown> {
    const request: CSRFProtectedRequest = {
      method: 'tools/call',
      params: { name, arguments: args },
      csrfToken: this.csrf.getToken(),
    };
    return this.send(request);
  }

  handleIncoming(request: CSRFProtectedRequest): void {
    if (!this.csrf.validate(request.csrfToken)) {
      throw new CSRFValidationError('Invalid or expired CSRF token');
    }
    // Process request...
  }
}
```

### SameSite Cookie Attributes

When using cookies for session management alongside MCP:

```typescript
// Set cookies with SameSite attribute
document.cookie = `session=${token}; SameSite=Strict; Secure; HttpOnly`;

// Cookie security levels:
// - SameSite=Strict: Only sent for same-site requests (most secure)
// - SameSite=Lax: Sent for top-level navigations (balanced)
// - SameSite=None; Secure: Sent for all requests (requires HTTPS)
```

### Double-Submit Cookie Pattern

For stateless CSRF protection:

```typescript
function doubleSubmitCsrf() {
  // Generate random token
  const token = crypto.randomUUID();

  // Set in cookie (automatically sent with requests)
  document.cookie = `csrf=${token}; SameSite=Strict; Secure`;

  // Also include in request header/body
  return {
    getCookie: () => getCookieValue('csrf'),
    getHeader: () => token,
    validate: (cookieValue: string, headerValue: string) => {
      return cookieValue === headerValue && cookieValue === token;
    },
  };
}
```

### Tool-Level CSRF Protection

Apply CSRF protection to sensitive tools:

```typescript
const csrfProtectedTools = ['store-set', 'submit-form', 'delete-resource', 'create-payment', 'modify-settings'];

function requiresCSRF(toolName: string): boolean {
  return csrfProtectedTools.includes(toolName);
}

// In tool execution flow
async function executeToolWithCSRF(name: string, args: unknown, csrfToken?: string): Promise<unknown> {
  if (requiresCSRF(name)) {
    if (!csrfToken || !csrf.validate(csrfToken)) {
      throw new CSRFValidationError(`CSRF token required for tool: ${name}`);
    }
  }
  return executeTool(name, args);
}
```

### Best Practices

1. **Always validate CSRF tokens** for state-changing operations
2. **Use short-lived tokens** (1 hour max) with automatic regeneration
3. **Combine with origin validation** - CSRF tokens don't replace origin checks
4. **Log CSRF failures** - Track potential attack attempts
5. **Use SameSite=Strict** cookies when possible

---

## Input Validation & Sanitization

### The Problem

Untrusted input from MCP clients can lead to:

- Injection attacks (XSS, SQL, command injection)
- Data corruption
- Security bypasses

### Zod Schema Validation

Use Zod for strict input validation:

```typescript
import { z } from 'zod';

// Define strict schemas for tool inputs
const userInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z\s]+$/),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
  bio: z.string().max(1000).optional(),
});

// Validate at tool boundary
server.registerTool('create-user', {
  inputSchema: userInputSchema,
  execute: async (args) => {
    // args is already validated and typed
    const validated = userInputSchema.parse(args);
    return createUser(validated);
  },
});
```

### HTML Sanitization

Never render untrusted HTML without sanitization:

```typescript
import DOMPurify from 'dompurify';

// DANGEROUS - Never do this
element.innerHTML = userInput; // XSS vulnerability!

// SAFE - Sanitize first
element.innerHTML = DOMPurify.sanitize(userInput, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  ALLOWED_ATTR: ['href'],
  ALLOW_DATA_ATTR: false,
});

// SAFEST - Use textContent for plain text
element.textContent = userInput; // Always safe
```

### UI Resource HTML Safety

When creating UI resources with `createUIResource()`:

```typescript
// DANGEROUS - User content in HTML template
const uiResource = createUIResource({
  html: `<div>${userInput}</div>`, // XSS risk!
});

// SAFE - Escape user content
import { escape } from 'lodash';
const uiResource = createUIResource({
  html: `<div>${escape(userInput)}</div>`,
});

// SAFER - Use data attributes and JavaScript
const uiResource = createUIResource({
  html: `
    <div id="content"></div>
    <script>
      const data = ${JSON.stringify(sanitizedData)};
      document.getElementById('content').textContent = data.userInput;
    </script>
  `,
});
```

### Large Payload Protection

Prevent resource exhaustion from oversized payloads:

```typescript
interface PayloadLimits {
  maxToolInputSize: number; // 1MB default
  maxResourceSize: number; // 10MB default
  maxStringLength: number; // 100KB default
  maxArrayLength: number; // 10000 items default
  maxObjectDepth: number; // 20 levels default
}

function validatePayloadSize(data: unknown, limits: PayloadLimits): void {
  const serialized = JSON.stringify(data);

  if (serialized.length > limits.maxToolInputSize) {
    throw new PayloadTooLargeError(`Payload size ${serialized.length} exceeds limit ${limits.maxToolInputSize}`);
  }

  // Check nested limits
  validateDepthAndSize(data, limits, 0);
}

function validateDepthAndSize(data: unknown, limits: PayloadLimits, depth: number): void {
  if (depth > limits.maxObjectDepth) {
    throw new PayloadTooDeepError(`Object depth exceeds ${limits.maxObjectDepth}`);
  }

  if (typeof data === 'string' && data.length > limits.maxStringLength) {
    throw new StringTooLongError(`String length exceeds ${limits.maxStringLength}`);
  }

  if (Array.isArray(data)) {
    if (data.length > limits.maxArrayLength) {
      throw new ArrayTooLongError(`Array length exceeds ${limits.maxArrayLength}`);
    }
    data.forEach((item) => validateDepthAndSize(item, limits, depth + 1));
  }

  if (typeof data === 'object' && data !== null) {
    Object.values(data).forEach((val) => validateDepthAndSize(val, limits, depth + 1));
  }
}
```

### Validation Best Practices

1. **Validate at the boundary** - Check inputs as soon as they enter your system
2. **Fail closed** - Reject invalid input rather than attempting to fix it
3. **Log validation failures** - Track potential attacks
4. **Use allowlists over blocklists** - Define what's allowed, not what's forbidden
5. **Validate output too** - Ensure your responses don't leak sensitive data

---

## PII Filtering

Prevent sensitive data (passwords, API keys, credit cards, SSNs) from reaching AI agents via telemetry events.

> **Full Documentation**: See [TELEMETRY.md](./TELEMETRY.md) for complete PII filtering API.

### The Problem

Browser telemetry (keyboard events, network requests, console logs) can inadvertently capture sensitive data:

- Keyboard events may capture password keystrokes
- Network requests contain authorization headers and API keys
- Console logs may include user PII in debug output
- Form inputs may contain credit cards, SSNs, etc.

### Solution: PII Filter Chain

All browser events pass through a filter chain **BEFORE** any MCP notification:

```
Browser Event → PII Filter Chain → MCP Notification
                      │
            Secrets filtered here
            (never reach AI agent)
```

### Built-in PII Patterns

The built-in filter automatically redacts:

| Pattern      | Example               | Replacement                  |
| ------------ | --------------------- | ---------------------------- |
| Email        | `user@example.com`    | `[REDACTED:email]`           |
| Credit Card  | `4111-1111-1111-1111` | `[REDACTED:credit-card]`     |
| SSN          | `123-45-6789`         | `[REDACTED:ssn]`             |
| Phone        | `+1-555-123-4567`     | `[REDACTED:phone]`           |
| Bearer Token | `Bearer eyJ...`       | `Bearer [REDACTED:token]`    |
| API Key      | `api_key=abc123...`   | `api_key=[REDACTED:api-key]` |
| JWT          | `eyJhbGc...`          | `[REDACTED:jwt]`             |
| IP Address   | `192.168.1.1`         | `[REDACTED:ip]`              |

### Configuration

```typescript
import { createEventCollector, createBuiltInPiiFilter } from '@frontmcp/browser/telemetry';

const collector = createEventCollector({
  categories: {
    interaction: { keyboard: true },
    network: { fetch: true },
    errors: { console: true },
  },
  filters: [
    createBuiltInPiiFilter({
      patterns: {
        email: true,
        creditCard: true,
        apiKey: true,
        bearerToken: true,
      },
    }),
  ],
});
```

### Custom Filters for Domain-Specific PII

```typescript
import { createPiiFilterPlugin } from '@frontmcp/browser/telemetry';

// HIPAA-compliant filter for healthcare
const hipaaFilter = createPiiFilterPlugin({
  name: 'hipaa',
  priority: 100, // Run before built-in
  patterns: [
    { name: 'mrn', pattern: /MRN[:\s]*\d{6,10}/gi },
    { name: 'dob', pattern: /\bDOB[:\s]*\d{1,2}\/\d{1,2}\/\d{2,4}/gi },
  ],
  filter(event, ctx) {
    // Drop events from patient-related URLs entirely
    if (event.data?.url?.includes('/patient/')) {
      return null; // Event dropped, never reaches AI
    }
    return event;
  },
});
```

### Fields Never Captured

These fields are NEVER captured regardless of configuration:

| Selector               | Reason                     |
| ---------------------- | -------------------------- |
| `[type="password"]`    | Password inputs            |
| `[data-pii="true"]`    | Developer-marked PII       |
| `Authorization` header | Auth tokens auto-redacted  |
| `Cookie` header        | Session data auto-redacted |

### Best Practices

1. **Use built-in filter** - Always include `createBuiltInPiiFilter()` in your filter chain
2. **Add domain-specific filters** - Create custom filters for industry-specific PII (healthcare, finance)
3. **Set filter priority** - Higher priority filters run first, use priority > 0 for custom filters
4. **Drop sensitive events** - Return `null` from filter to drop events entirely
5. **Disable value capture** - Set `captureValue: false` for keyboard/input events
6. **Mark PII elements** - Add `data-pii="true"` to sensitive form fields
7. **Audit filter actions** - Enable audit logging for compliance

---

## XSS Prevention

### DOM-Based XSS

Prevent XSS when rendering dynamic content:

```typescript
// DANGEROUS patterns - Never use these with untrusted data
element.innerHTML = untrustedData;
element.outerHTML = untrustedData;
document.write(untrustedData);
eval(untrustedData);
new Function(untrustedData);
setTimeout(untrustedData, 0);
setInterval(untrustedData, 0);

// SAFE patterns
element.textContent = untrustedData; // Always safe
element.innerText = untrustedData; // Safe but slower

// For attributes
element.setAttribute('data-value', untrustedData); // Safe for data attributes
element.href = untrustedData; // DANGEROUS - validate URL first!
```

### URL Validation

Validate URLs before using them:

```typescript
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Block javascript: protocol (case-insensitive)
    if (url.toLowerCase().startsWith('javascript:')) {
      return false;
    }

    // Block data: URLs for scripts
    if (parsed.protocol === 'data:') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Usage
if (isAllowedUrl(userProvidedUrl)) {
  element.href = userProvidedUrl;
}
```

### React-Specific XSS Prevention

React escapes by default, but watch for these pitfalls:

```tsx
// SAFE - React escapes automatically
<div>{userInput}</div>

// DANGEROUS - dangerouslySetInnerHTML bypasses escaping
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// If you must use dangerouslySetInnerHTML, sanitize first
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userInput)
}} />

// DANGEROUS - href can execute JavaScript
<a href={userInput}>Link</a>  // XSS if userInput = "javascript:alert(1)"

// SAFE - Validate URL first
<a href={isAllowedUrl(userInput) ? userInput : '#'}>Link</a>
```

### CSP for XSS Mitigation

Use Content Security Policy as defense-in-depth:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self';
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';
```

---

## Authentication Patterns

### The Problem

MCP tools execute in browser context but need to know who the user is. Without proper authentication:

- Any client can call sensitive tools
- Audit logs lack user attribution
- Authorization decisions can't be made

### Session Integration

Pass authenticated session to MCP context:

```typescript
interface AuthenticatedMcpContext {
  user: {
    id: string;
    email: string;
    roles: string[];
  };
  sessionId: string;
  expiresAt: number;
}

// Create MCP server with auth context
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  transport: new EventTransport(),
  authContext: getAuthContext(), // Inject from your auth system
});

// Access in tools
server.registerTool('admin-action', {
  description: 'Administrative action',
  inputSchema: z.object({ action: z.string() }),
  execute: async (args, context) => {
    // Check authorization
    if (!context.auth?.user?.roles.includes('admin')) {
      throw new UnauthorizedError('Admin role required');
    }

    // Log with user attribution
    auditLog.record({
      action: 'admin-action',
      user: context.auth.user.id,
      args,
      timestamp: Date.now(),
    });

    return performAdminAction(args.action);
  },
});
```

### JWT Token Validation

Validate JWT tokens in browser:

```typescript
// Note: In browser, you can verify JWT structure but not signature
// (unless you embed the public key, which has its own risks)

interface JWTPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  iat: number; // Issued at
  exp: number; // Expires at
}

function parseJWT(token: string): JWTPayload | null {
  try {
    const [, payloadBase64] = token.split('.');
    const payload = JSON.parse(atob(payloadBase64));

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.warn('JWT token expired');
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// Use in App Bridge for embedded apps
const host = createAppHost({
  container: document.getElementById('apps'),
  authContext: {
    token: localStorage.getItem('jwt'),
    user: parseJWT(localStorage.getItem('jwt')),
  },
});
```

### Timing Attack Prevention

**⚠️ SECURITY: Use constant-time comparison for sensitive values**

Standard string comparison (`===`) can leak information through timing differences. Attackers can measure response times to deduce token values or password hashes.

```typescript
/**
 * Constant-time string comparison to prevent timing attacks.
 * Use for comparing tokens, signatures, and other sensitive values.
 */
function constantTimeCompare(a: string, b: string): boolean {
  // Always compare full length to prevent length-based timing leaks
  const maxLength = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLength, '\0');
  const bPadded = b.padEnd(maxLength, '\0');

  let result = 0;
  for (let i = 0; i < maxLength; i++) {
    // XOR each character - timing is constant regardless of match
    result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
  }

  // Also check original lengths match
  result |= a.length ^ b.length;

  return result === 0;
}

/**
 * Constant-time buffer comparison using Web Crypto API.
 * More secure for binary data like HMAC signatures.
 */
async function constantTimeBufferCompare(a: ArrayBuffer, b: ArrayBuffer): Promise<boolean> {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);

  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }

  return result === 0;
}
```

**Where to Use Constant-Time Comparison:**

| Context                     | Use Constant-Time? | Reason                     |
| --------------------------- | ------------------ | -------------------------- |
| HMAC signature verification | ✅ Yes             | Prevents signature forgery |
| CSRF token validation       | ✅ Yes             | Prevents token prediction  |
| Session token comparison    | ✅ Yes             | Prevents session hijacking |
| Password hash comparison    | ✅ Yes             | Prevents timing oracle     |
| User ID lookup              | ❌ No              | Not security-sensitive     |
| Tool name matching          | ❌ No              | Public information         |

**Secure Token Validation Pattern:**

```typescript
interface SecureTokenValidator {
  validate(provided: string, expected: string): boolean;
}

class TimingSafeTokenValidator implements SecureTokenValidator {
  validate(provided: string, expected: string): boolean {
    // Use constant-time comparison
    return constantTimeCompare(provided, expected);
  }
}

// Usage in CSRF middleware
function validateCsrfToken(request: Request, session: Session): boolean {
  const providedToken = request.headers.get('x-csrf-token');
  const expectedToken = session.csrfToken;

  if (!providedToken || !expectedToken) {
    return false;
  }

  // ✅ Constant-time comparison
  return constantTimeCompare(providedToken, expectedToken);
}

// ❌ DANGEROUS - vulnerable to timing attacks
function insecureValidation(provided: string, expected: string): boolean {
  return provided === expected; // Early exit reveals information
}
```

**Secure HMAC Verification:**

```typescript
async function verifyHmacSignature(message: string, signature: string, secretKey: CryptoKey): Promise<boolean> {
  // Compute expected signature
  const encoder = new TextEncoder();
  const expectedSignature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(message));

  // Decode provided signature
  const providedSignature = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)).buffer;

  // ✅ Constant-time comparison of signatures
  return constantTimeBufferCompare(expectedSignature, providedSignature);
}
```

### Per-Tool Authorization

Implement role-based access control:

```typescript
type Permission = 'read' | 'write' | 'admin' | 'delete';

interface ToolPermissions {
  [toolName: string]: Permission[];
}

const toolPermissions: ToolPermissions = {
  'read-data': ['read'],
  'update-settings': ['write'],
  'delete-user': ['admin', 'delete'],
  'view-audit-log': ['admin'],
};

function authorizeToolCall(toolName: string, userRoles: string[], userPermissions: Permission[]): boolean {
  const required = toolPermissions[toolName] || [];

  // User must have at least one required permission
  return required.length === 0 || required.some((p) => userPermissions.includes(p));
}

// Middleware pattern
async function withAuthorization(
  toolName: string,
  context: AuthenticatedMcpContext,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  if (!authorizeToolCall(toolName, context.user.roles, getUserPermissions(context.user))) {
    throw new ForbiddenError(`User lacks permission for tool: ${toolName}`);
  }
  return execute();
}
```

### Secure Token Storage

Best practices for storing auth tokens in browser:

```typescript
// GOOD: HttpOnly cookies (set by server)
// Token is automatically sent with requests
// Not accessible to JavaScript (XSS protection)

// ACCEPTABLE: sessionStorage (cleared when tab closes)
sessionStorage.setItem('token', jwt);

// CAUTION: localStorage (persists across sessions)
// Vulnerable to XSS, but convenient
localStorage.setItem('token', jwt);

// AVOID: Global variables
window.authToken = jwt; // Easily accessible to attackers

// Memory-only storage for sensitive tokens
class SecureTokenStore {
  private token: string | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  clearToken(): void {
    this.token = null;
  }
}
```

---

## Rate Limiting

### The Problem

Without rate limiting, malicious actors can:

- Flood the transport with messages (DoS)
- Exhaust browser resources
- Trigger excessive store mutations

### Implementation

```typescript
interface RateLimitOptions {
  maxRequests: number; // Max requests per window
  windowMs: number; // Time window in ms
  onLimitExceeded?: () => void;
}

class RateLimiter {
  private requests: number[] = [];

  constructor(private options: RateLimitOptions) {}

  check(): boolean {
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    // Remove old requests
    this.requests = this.requests.filter((t) => t > windowStart);

    if (this.requests.length >= this.options.maxRequests) {
      this.options.onLimitExceeded?.();
      return false;
    }

    this.requests.push(now);
    return true;
  }
}

// Usage in transport
class RateLimitedTransport implements BrowserTransport {
  private limiter = new RateLimiter({
    maxRequests: 100,
    windowMs: 1000, // 100 requests per second
    onLimitExceeded: () => console.warn('Rate limit exceeded'),
  });

  send(message: JSONRPCMessage): void {
    if (!this.limiter.check()) {
      throw new Error('Rate limit exceeded');
    }
    this.innerTransport.send(message);
  }
}
```

### Recommended Limits

| Context         | Max Requests/sec | Notes                        |
| --------------- | ---------------- | ---------------------------- |
| Main thread     | 100              | Prevents UI blocking         |
| WebWorker       | 500              | Higher throughput OK         |
| Store mutations | 50               | Prevent excessive re-renders |
| Render calls    | 10               | DOM operations are expensive |

---

## Store Authorization

### The Problem

The `store-set` tool allows any MCP client to mutate any store key. This can lead to:

- Unauthorized data modification
- State corruption
- Privilege escalation

### Mutation Guards

Implement path-based authorization:

```typescript
type MutationGuard = (
  path: string[],
  value: unknown,
  context: { clientId?: string; sessionId?: string },
) => boolean | Promise<boolean>;

interface SecureStoreOptions<T> {
  initial: T;
  guards?: MutationGuard[];
  readOnlyPaths?: string[][];
  allowedClients?: string[];
}

function createSecureStore<T extends object>(options: SecureStoreOptions<T>) {
  const store = createMcpStore(options.initial);

  // Wrap mutations with authorization
  const originalSet = store.set;
  store.set = async (path: string[], value: unknown, context: unknown) => {
    // Check read-only paths
    if (options.readOnlyPaths?.some((ro) => pathMatches(path, ro))) {
      throw new UnauthorizedMutationError(`Path ${path.join('.')} is read-only`);
    }

    // Run guards
    for (const guard of options.guards ?? []) {
      if (!(await guard(path, value, context))) {
        throw new UnauthorizedMutationError(`Mutation denied by guard`);
      }
    }

    return originalSet(path, value);
  };

  return store;
}
```

### Example Guards

```typescript
// Only allow authenticated users
const authGuard: MutationGuard = (path, value, ctx) => {
  return ctx.sessionId != null;
};

// Protect user data from other users
const ownershipGuard: MutationGuard = (path, value, ctx) => {
  if (path[0] === 'users' && path[1] !== ctx.clientId) {
    return false; // Can only modify own user data
  }
  return true;
};

// Schema validation guard
const schemaGuard: MutationGuard = (path, value) => {
  const schema = getSchemaForPath(path);
  return schema ? schema.safeParse(value).success : true;
};

// Usage
const store = createSecureStore({
  initial: { users: {}, settings: {} },
  guards: [authGuard, ownershipGuard, schemaGuard],
  readOnlyPaths: [['settings', 'systemConfig']],
});
```

### Prototype Pollution Protection

**⚠️ CRITICAL SECURITY REQUIREMENT**

Store mutations MUST validate paths to prevent prototype pollution attacks:

```typescript
const DANGEROUS_PATHS = ['__proto__', 'constructor', 'prototype'];

/**
 * Validates store path against prototype pollution attacks.
 * MUST be called before any store mutation.
 */
function validateStorePath(path: string | string[]): void {
  const segments = Array.isArray(path) ? path : path.split('.');

  for (const segment of segments) {
    if (DANGEROUS_PATHS.includes(segment.toLowerCase())) {
      throw new SecurityError(`Blocked prototype pollution attempt: "${segment}" in path`);
    }

    // Also check for bracket notation attacks
    if (segment.includes('[') || segment.includes(']')) {
      throw new SecurityError(`Invalid path segment: "${segment}" - bracket notation not allowed`);
    }
  }
}

// Prototype pollution guard - ALWAYS include this guard
const prototypePollutionGuard: MutationGuard = (path) => {
  try {
    validateStorePath(path);
    return true;
  } catch (error) {
    console.error('Prototype pollution attempt blocked:', path);
    return false;
  }
};
```

**Attack Scenario:**

```typescript
// Without protection, attacker can send:
{ path: "__proto__.isAdmin", value: true }
// or
{ path: "constructor.prototype.isAdmin", value: true }

// Result: ALL objects inherit isAdmin: true
// This can lead to privilege escalation
```

**Required Implementation:**

```typescript
// ALWAYS include prototype pollution guard FIRST
const store = createSecureStore({
  initial: { users: {}, settings: {} },
  guards: [
    prototypePollutionGuard, // MUST be first
    authGuard,
    ownershipGuard,
    schemaGuard,
  ],
  readOnlyPaths: [['settings', 'systemConfig']],
});
```

---

## Content Security Policy

### Required CSP Headers

For applications using FrontMCP Browser:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:;
  connect-src 'self';
  style-src 'self' 'unsafe-inline';
```

### CSP Breakdown

| Directive         | Value                        | Reason                              |
| ----------------- | ---------------------------- | ----------------------------------- |
| `script-src`      | `'self' 'wasm-unsafe-eval'`  | Allow local scripts, WASM if needed |
| `worker-src`      | `'self' blob:`               | Allow WebWorkers from same origin   |
| `connect-src`     | `'self'`                     | Restrict network connections        |
| `frame-ancestors` | `'self'` or specific origins | Prevent clickjacking                |

### WebWorker-Specific CSP

Workers inherit CSP from the parent document but have additional considerations:

```typescript
// Worker script should validate its own origin
if (self.origin !== 'https://trusted-app.example.com') {
  throw new Error('Worker loaded from untrusted origin');
}
```

---

## WebWorker Sandboxing

### Benefits of WebWorker Isolation

Running MCP server in a WebWorker provides:

- **Separate global scope** - No access to DOM or window
- **Memory isolation** - Worker crash doesn't affect main thread
- **Controlled communication** - Only postMessage channel

### Limitations to Understand

WebWorkers **cannot**:

- Access the DOM directly
- Use `localStorage` (use IndexedDB instead)
- Access cookies
- Run synchronous XHR (already deprecated)

WebWorkers **can**:

- Access IndexedDB
- Make fetch requests
- Use Web Crypto API
- Import scripts dynamically

### Secure Worker Pattern

```typescript
// main.ts - Create worker with blob URL to prevent external loading
const workerCode = `
  importScripts('${location.origin}/mcp-worker.js');
`;
const blob = new Blob([workerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(blob));

// worker.ts - Validate messages strictly
self.onmessage = (event: MessageEvent) => {
  // Validate message structure
  if (!isValidMcpMessage(event.data)) {
    console.error('Invalid message structure');
    return;
  }

  // Process in try-catch to prevent worker crash
  try {
    processMessage(event.data);
  } catch (error) {
    self.postMessage({
      jsonrpc: '2.0',
      id: event.data.id,
      error: { code: -32603, message: 'Internal error' },
    });
  }
};
```

---

## Iframe Sandboxing

### Overview

When embedding FrontMCP apps in iframes (via App Bridge), proper sandboxing is critical for security isolation.

> **Related**: See [APP-BRIDGE.md](./APP-BRIDGE.md) for the full App Bridge documentation.

### Sandbox Attributes

```html
<iframe src="https://mcp-app.example.com" sandbox="allow-scripts allow-same-origin" allow=""></iframe>
```

### Permission Reference

| Attribute              | Purpose                      | Security Consideration               |
| ---------------------- | ---------------------------- | ------------------------------------ |
| `allow-scripts`        | Enable JavaScript            | Required for MCP apps to function    |
| `allow-same-origin`    | Access same-origin resources | Required for IndexedDB, localStorage |
| `allow-forms`          | Submit forms                 | Only if app needs forms              |
| `allow-popups`         | Open new windows             | Usually deny - security risk         |
| `allow-modals`         | Show `alert()`, `confirm()`  | Only if needed for HiTL              |
| `allow-top-navigation` | Navigate parent window       | Always deny - security risk          |
| `allow-downloads`      | Trigger downloads            | Only if needed                       |

### Recommended Configuration

**Minimal (Most Secure):**

```typescript
sandbox: ['allow-scripts']; // No storage, no forms
```

**Standard (With Storage):**

```typescript
sandbox: ['allow-scripts', 'allow-same-origin']; // IndexedDB access
```

**Full (With Forms):**

```typescript
sandbox: ['allow-scripts', 'allow-same-origin', 'allow-forms'];
```

### CSP for Iframes

```typescript
// Inject CSP via meta tag in iframe content
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'self' https://trusted-host.com",
].join('; ');

// Or set via Content-Security-Policy header
```

### Iframe Communication Security

```typescript
// Host side - validate messages from iframe
iframe.contentWindow.addEventListener('message', (event) => {
  // Verify origin
  if (event.origin !== 'https://mcp-app.example.com') {
    console.error('Message from untrusted origin:', event.origin);
    return;
  }

  // Verify message type
  if (event.data?.type !== 'mcp') {
    return;
  }

  // Process verified message
  handleMcpMessage(event.data.payload);
});

// Iframe side - always specify target origin
parent.postMessage(
  { type: 'mcp', payload: message },
  'https://trusted-host.com', // Never use '*'
);
```

### Feature Policy / Permissions Policy

Restrict browser features available to iframe:

```html
<iframe
  src="https://mcp-app.example.com"
  sandbox="allow-scripts allow-same-origin"
  allow="clipboard-read; clipboard-write"
></iframe>
```

**Recommended Permissions:**

```typescript
const permissions = [
  // Allow
  'clipboard-read', // If app needs clipboard access
  'clipboard-write', // If app needs clipboard access

  // Deny (omit from allow list)
  'camera', // No camera access
  'microphone', // No microphone access
  'geolocation', // No location access
  'payment', // No payment API
  'usb', // No USB access
];
```

---

## Human-in-the-Loop (HiTL)

### Philosophy

Human-in-the-Loop is a security philosophy where users confirm sensitive AI actions before execution. This is critical for:

- **Trust** - Users maintain control over AI actions
- **Safety** - Prevent unintended consequences
- **Accountability** - Clear audit trail of approvals
- **Compliance** - Meet regulatory requirements

> **Competitor Note**: This pattern is a core feature of WebMCP.

### When to Require Confirmation

| Action Type          | Confirmation | Rationale              |
| -------------------- | ------------ | ---------------------- |
| Read-only operations | No           | Low risk               |
| Store mutations      | Configurable | Depends on sensitivity |
| Render UI            | No           | Reversible             |
| Form submission      | Yes          | External effects       |
| Data export          | Yes          | Data leaving app       |
| Destructive actions  | Always       | Irreversible           |
| External API calls   | Yes          | Side effects           |

### Implementation

```typescript
interface HiTLConfig {
  /**
   * Tools that always require confirmation
   */
  alwaysConfirm: string[];

  /**
   * Tools that never require confirmation
   */
  neverConfirm: string[];

  /**
   * Timeout for confirmation dialog (ms)
   * @default 30000
   */
  confirmationTimeout: number;

  /**
   * What to do on timeout
   * @default 'deny'
   */
  timeoutBehavior: 'deny' | 'allow';

  /**
   * Callback when confirmation required
   */
  onConfirmationRequired: (action: string, args: unknown) => Promise<boolean>;

  /**
   * Callback for audit logging
   */
  onAuditLog?: (entry: AuditLogEntry) => void;
}

interface AuditLogEntry {
  timestamp: number;
  action: string;
  args: unknown;
  decision: 'approved' | 'denied' | 'timeout';
  decisionBy: 'user' | 'system' | 'timeout';
  durationMs: number;
}
```

### HiTL Wrapper

```typescript
async function withHumanConfirmation<T>(
  config: HiTLConfig,
  action: string,
  args: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();

  // Check if confirmation needed
  if (config.neverConfirm.includes(action)) {
    const result = await execute();
    logAudit(config, action, args, 'approved', 'system', startTime);
    return result;
  }

  if (config.alwaysConfirm.includes(action) || needsConfirmation(action)) {
    // Request human confirmation
    const confirmedPromise = config.onConfirmationRequired(action, args);

    // Apply timeout
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(config.timeoutBehavior === 'allow');
      }, config.confirmationTimeout);
    });

    const confirmed = await Promise.race([confirmedPromise, timeoutPromise]);

    if (!confirmed) {
      logAudit(config, action, args, 'denied', 'user', startTime);
      throw new UserDeclinedError(action);
    }

    logAudit(config, action, args, 'approved', 'user', startTime);
  }

  return execute();
}

function logAudit(
  config: HiTLConfig,
  action: string,
  args: unknown,
  decision: AuditLogEntry['decision'],
  decisionBy: AuditLogEntry['decisionBy'],
  startTime: number,
) {
  config.onAuditLog?.({
    timestamp: Date.now(),
    action,
    args,
    decision,
    decisionBy,
    durationMs: Date.now() - startTime,
  });
}
```

### React Integration

```typescript
// ConfirmationProvider.tsx
interface ConfirmationContextType {
  confirm: (action: string, args: unknown) => Promise<boolean>;
  pendingConfirmations: PendingConfirmation[];
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

export function ConfirmationProvider({ children, config }: Props) {
  const [pending, setPending] = useState<PendingConfirmation[]>([]);

  const confirm = useCallback(async (action: string, args: unknown) => {
    return new Promise<boolean>((resolve) => {
      const confirmation: PendingConfirmation = {
        id: crypto.randomUUID(),
        action,
        args,
        resolve,
        createdAt: Date.now(),
      };
      setPending((prev) => [...prev, confirmation]);
    });
  }, []);

  const handleDecision = (id: string, approved: boolean) => {
    const confirmation = pending.find((p) => p.id === id);
    if (confirmation) {
      confirmation.resolve(approved);
      setPending((prev) => prev.filter((p) => p.id !== id));
    }
  };

  return (
    <ConfirmationContext.Provider value={{ confirm, pendingConfirmations: pending }}>
      {children}
      {pending.map((p) => (
        <ConfirmationDialog
          key={p.id}
          action={p.action}
          args={p.args}
          onApprove={() => handleDecision(p.id, true)}
          onDeny={() => handleDecision(p.id, false)}
          timeout={config.confirmationTimeout}
        />
      ))}
    </ConfirmationContext.Provider>
  );
}

// Usage in tool
function useConfirmedTool(name: string) {
  const { confirm } = useConfirmation();
  const { callTool } = useMcp();

  return useCallback(
    async (args: unknown) => {
      if (await confirm(name, args)) {
        return callTool(name, args);
      }
      throw new UserDeclinedError(name);
    },
    [name, confirm, callTool],
  );
}
```

### Confirmation Dialog UX

```typescript
// ConfirmationDialog.tsx
function ConfirmationDialog({ action, args, onApprove, onDeny, timeout }: Props) {
  const [remaining, setRemaining] = useState(timeout);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1000) {
          onDeny(); // Auto-deny on timeout
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeout, onDeny]);

  return (
    <Dialog open>
      <DialogTitle>Action Confirmation Required</DialogTitle>
      <DialogContent>
        <p>The AI wants to perform the following action:</p>
        <CodeBlock>{action}</CodeBlock>
        <details>
          <summary>Show arguments</summary>
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </details>
        <ProgressBar value={(timeout - remaining) / timeout} />
        <p>Time remaining: {Math.ceil(remaining / 1000)}s</p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDeny} color="error">
          Deny
        </Button>
        <Button onClick={onApprove} color="primary" variant="contained">
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

### Audit Logging

```typescript
// Persist audit logs for compliance
interface AuditLogger {
  log(entry: AuditLogEntry): void;
  query(filters: AuditQueryFilters): Promise<AuditLogEntry[]>;
  export(format: 'json' | 'csv'): Promise<string>;
}

// IndexedDB-based audit logger
class IndexedDBAuditLogger implements AuditLogger {
  private db: IDBDatabase;

  async log(entry: AuditLogEntry): Promise<void> {
    const tx = this.db.transaction('audit', 'readwrite');
    const store = tx.objectStore('audit');
    await store.add({
      ...entry,
      id: crypto.randomUUID(),
    });
  }

  async query(filters: AuditQueryFilters): Promise<AuditLogEntry[]> {
    // Query by date range, action type, decision, etc.
  }

  async export(format: 'json' | 'csv'): Promise<string> {
    const entries = await this.query({});
    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }
    return toCSV(entries);
  }
}
```

### Best Practices

1. **Default to confirmation** - When in doubt, ask the user
2. **Clear descriptions** - Explain what the action will do
3. **Show arguments** - Let users inspect what's being sent
4. **Timeout appropriately** - 30 seconds default, configurable
5. **Log everything** - Maintain audit trail for compliance
6. **Don't interrupt too often** - Balance security with usability
7. **Allow bulk approvals** - For repeated similar actions

---

## Security Checklist

Before deploying FrontMCP Browser:

### Transport Security

- [ ] PostMessageTransport uses explicit origin (not `'*'`)
- [ ] Origin violations are logged/monitored
- [ ] Rate limiting is configured
- [ ] Consider HMAC signing for sensitive data

### Store Security

- [ ] Sensitive paths are protected with guards
- [ ] Read-only paths are configured
- [ ] Schema validation is in place
- [ ] Mutation logging is enabled

### Infrastructure Security

- [ ] CSP headers are configured
- [ ] WebWorker is used for isolation (if applicable)
- [ ] HTTPS is enforced
- [ ] Frame-ancestors prevents embedding

### Iframe Sandboxing (App Bridge)

- [ ] Sandbox attributes are minimal (only what's needed)
- [ ] `allow-top-navigation` is NOT included
- [ ] `allow-popups` is NOT included unless required
- [ ] CSP is injected in iframe content
- [ ] Permissions Policy restricts browser features

### Human-in-the-Loop

- [ ] Destructive actions require user confirmation
- [ ] External API calls require confirmation
- [ ] Confirmation timeout is configured
- [ ] Audit logging is enabled
- [ ] Decision history is persisted

### Monitoring

- [ ] Security events are logged
- [ ] Rate limit violations are tracked
- [ ] Unauthorized access attempts are alerted
- [ ] HiTL decisions are logged for audit

---

## Threat Model

### Overview

This threat model identifies actors, attack vectors, and mitigations for FrontMCP Browser deployments. Understanding these threats helps developers make informed security decisions.

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      TRUSTED ZONE                            │
│  ┌─────────────────┐    ┌──────────────────┐                │
│  │ Application Code │    │ Authenticated    │                │
│  │ (Same Origin)    │◄──►│ User Sessions    │                │
│  └─────────────────┘    └──────────────────┘                │
│           │                      │                           │
│           ▼                      ▼                           │
│  ┌─────────────────────────────────────────┐                │
│  │         FrontMCP Browser Server          │                │
│  │  - Store, Registry, Transport, Tools     │                │
│  └─────────────────────────────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│                    TRUST BOUNDARY                            │
├─────────────────────────────────────────────────────────────┤
│                    UNTRUSTED ZONE                            │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ Other Tabs │  │ Iframes     │  │ AI Agents   │           │
│  │ / Windows  │  │ (Other Orig)│  │ (External)  │           │
│  └────────────┘  └─────────────┘  └─────────────┘           │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ Browser    │  │ Network     │  │ Malicious   │           │
│  │ Extensions │  │ Attackers   │  │ Scripts     │           │
│  └────────────┘  └─────────────┘  └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Threat Actors

#### 1. Malicious AI Agents

**Capabilities:**

- Send arbitrary MCP requests
- Attempt to call tools without proper authorization
- Try to exfiltrate data through tool responses
- Overwhelm the system with requests

**Mitigations:**

- Human-in-the-Loop (HiTL) for sensitive operations
- Per-tool authorization with role-based access
- Rate limiting on all transports
- Input validation with Zod schemas
- Audit logging of all AI actions

#### 2. Cross-Origin Iframes

**Capabilities:**

- Send postMessage to parent window
- Attempt to impersonate legitimate MCP apps
- Try to escape sandbox restrictions

**Mitigations:**

- Strict origin validation (`allowedOrigins`)
- Sandbox attributes limiting iframe capabilities
- CSP with `frame-ancestors` directive
- Message signing for integrity

#### 3. Other Browser Tabs/Windows

**Capabilities:**

- Open windows to same origin
- Use BroadcastChannel for same-origin messaging
- Shared access to localStorage/IndexedDB

**Mitigations:**

- Session isolation
- CSRF tokens for state changes
- Nonce-based replay prevention
- Tab-specific session IDs

#### 4. Browser Extensions

**Capabilities:**

- Inject scripts into page context
- Intercept and modify network requests
- Access localStorage and cookies
- Modify DOM

**Mitigations:**

- CSP to limit script execution
- Sensitive data in memory only (not localStorage)
- Server-side validation of critical operations
- HiTL for irreversible actions

#### 5. Network Attackers (MITM)

**Capabilities:**

- Intercept unencrypted traffic
- Modify requests/responses
- Inject malicious content

**Mitigations:**

- HTTPS enforcement
- HMAC message signing
- Certificate pinning (for native apps)
- Strict CSP

#### 6. Malicious Tool Developers

**Capabilities:**

- Register tools that exfiltrate data
- Create tools with hidden side effects
- Attempt privilege escalation

**Mitigations:**

- Tool code review before registration
- Sandboxed tool execution
- Capability-based permissions
- Monitoring and alerting

### Attack Scenarios

#### Scenario 1: XSS via UI Resource

**Attack:** Attacker crafts tool response containing malicious HTML that executes JavaScript when rendered.

**Vector:** `createUIResource({ html: '<script>steal(document.cookie)</script>' })`

**Mitigations:**

1. Render UI resources in sandboxed iframes
2. CSP blocks inline scripts
3. DOMPurify sanitization before rendering
4. Content-Type validation

#### Scenario 2: Store Poisoning

**Attack:** Malicious client sends store mutations to corrupt application state.

**Vector:** `callTool('store-set', { key: 'user.role', value: 'admin' })`

**Mitigations:**

1. Path-based mutation guards
2. Read-only path configuration
3. Schema validation on mutations
4. Audit logging

#### Scenario 3: Tool Parameter Injection

**Attack:** Attacker sends specially crafted tool parameters to trigger unintended behavior.

**Vector:** `callTool('search', { query: '"; DROP TABLE users; --' })`

**Mitigations:**

1. Zod schema validation
2. Parameterized queries (if applicable)
3. Input sanitization
4. Output encoding

#### Scenario 4: Denial of Service

**Attack:** Flood transport with requests to exhaust browser resources.

**Vector:** `while(true) { callTool('expensive-operation', {}) }`

**Mitigations:**

1. Rate limiting (100 req/sec default)
2. Request timeout (30 sec default)
3. Payload size limits
4. Circuit breaker pattern

#### Scenario 5: Session Hijacking

**Attack:** Steal session token to impersonate authenticated user.

**Vector:** Access `localStorage.getItem('session')` via XSS or extension

**Mitigations:**

1. HttpOnly cookies when possible
2. Short session lifetimes
3. Session binding to client fingerprint
4. Secure token storage in memory

#### Scenario 6: Iframe Sandbox Escape

**Attack:** Embedded app attempts to break out of sandbox restrictions.

**Vector:** Using `allow-top-navigation` to redirect parent window

**Mitigations:**

1. Never include `allow-top-navigation`
2. Minimal sandbox permissions
3. CSP `frame-ancestors`
4. Origin validation on all messages

### Risk Assessment Matrix

| Threat              | Likelihood | Impact | Risk Level | Mitigation Priority |
| ------------------- | ---------- | ------ | ---------- | ------------------- |
| XSS via UI Resource | Medium     | High   | **High**   | Immediate           |
| Store Poisoning     | Medium     | High   | **High**   | Immediate           |
| Malicious AI Agent  | High       | Medium | **High**   | Immediate           |
| DoS Attack          | Medium     | Medium | **Medium** | Short-term          |
| Session Hijacking   | Low        | High   | **Medium** | Short-term          |
| CSRF                | Low        | Medium | **Low**    | Ongoing             |
| Timing Attacks      | Low        | Low    | **Low**    | Long-term           |

### Security Assumptions

1. **Browser is not compromised** - Native browser security is working correctly
2. **Same-origin code is trusted** - Application code from same origin is not malicious
3. **HTTPS is enforced** - All communications are encrypted in transit
4. **CSP is configured** - Content Security Policy headers are set
5. **User is authenticated** - Parent application handles user authentication

### Defense in Depth Layers

```
Layer 1: Network Security
├── HTTPS encryption
├── CSP headers
└── HSTS enforcement

Layer 2: Transport Security
├── Origin validation
├── Message signing
└── Rate limiting

Layer 3: Application Security
├── Input validation (Zod)
├── Output encoding
└── CSRF protection

Layer 4: Data Security
├── Store authorization guards
├── Path-based access control
└── Audit logging

Layer 5: User Security
├── Human-in-the-Loop (HiTL)
├── Confirmation dialogs
└── Session management
```

### Out of Scope

The following threats are considered out of scope for FrontMCP Browser security:

1. **Compromised browser** - If the browser itself is malicious, no client-side code can be trusted
2. **Physical device access** - Physical access bypasses all software security
3. **Malicious same-origin code** - If your own application code is compromised, FrontMCP cannot protect you
4. **Zero-day browser vulnerabilities** - Novel browser exploits require browser vendor patches
5. **Social engineering** - Users can always be tricked into approving malicious actions

### Compliance Considerations

#### GDPR

- Store only necessary data
- Implement data export (`query` method on stores)
- Support data deletion
- Maintain audit logs for data access

#### SOC 2

- Enable comprehensive audit logging
- Implement access controls (authorization guards)
- Monitor for security events
- Document security policies

#### HIPAA (if applicable)

- Encrypt sensitive data at rest (consider Web Crypto API)
- Implement access controls
- Maintain audit trails
- Session timeout enforcement

---

## Reporting Security Issues

If you discover a security vulnerability in FrontMCP Browser:

1. **Do not** open a public issue
2. Email security concerns to the maintainers
3. Include steps to reproduce
4. Allow reasonable time for a fix before disclosure
