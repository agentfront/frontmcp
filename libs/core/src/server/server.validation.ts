// write-response.ts
import { HttpCookie, httpOutputSchema, ServerResponse } from '@frontmcp/sdk';
import { Buffer } from 'node:buffer';

/* ----------------------- helpers ----------------------- */

function serializeCookie(c: HttpCookie): string {
  const parts: string[] = [`${c.name}=${encodeURIComponent(c.value)}`];
  if (c.path) parts.push(`Path=${c.path}`);
  if (c.domain) parts.push(`Domain=${c.domain}`);
  if (c.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(c.maxAge))}`);
  if (c.expires) parts.push(`Expires=${c.expires.toUTCString()}`);
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.secure) parts.push('Secure');
  if (c.sameSite) parts.push(`SameSite=${c.sameSite[0].toUpperCase()}${c.sameSite.slice(1)}`);
  return parts.join('; ');
}

function applyHeaders(res: ServerResponse, headers?: Record<string, string | string[]>) {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
}

function applyCookies(res: ServerResponse, cookies?: Array<HttpCookie>) {
  if (!cookies || cookies.length === 0) return;
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
  const existingArr = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  const cookieStrings = cookies.map(serializeCookie);
  res.setHeader('Set-Cookie', [...existingArr, ...cookieStrings]);
}

function contentDisposition(disposition: 'inline' | 'attachment', filename?: string) {
  return `${disposition}${filename ? `; filename="${filename}"` : ''}`;
}

function utf8ByteLength(s: string): number {
  // TextEncoder is universal (Node 16+ & browsers)
  const enc = new TextEncoder();
  return enc.encode(s).byteLength;
}

function stringToBytes(str: string, encoding: 'utf8' | 'base64'): Uint8Array {
  if (encoding === 'utf8') {
    return new TextEncoder().encode(str);
  }
  // base64
  return Buffer.from(str, 'base64');
}

/* ----------------------- writer ------------------------ */

export async function writeHttpResponse(res: ServerResponse, value: any): Promise<void> {
  const parsed = httpOutputSchema.safeParse(value);
  if (!parsed.success) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(500).end('Internal Server Error');
    return;
  }

  const out = parsed.data;

  if (out.kind === 'next' || out.kind === 'consumed') {
    return;
  }

  // common headers/cookies first
  const { headers, cookies } = out as any;
  if (headers) {
    applyHeaders(res, headers);
  }
  if (cookies) {
    applyCookies(res, cookies);
  }

  switch (out.kind) {
    case 'redirect': {
      res.setHeader('Location', out.location);
      if ('redirect' in res && typeof res.redirect === 'function') {
        res.redirect(out.location);
      } else {
        res.status(out.status).end();
      }
      return;
    }

    case 'json': {
      res.setHeader('Content-Type', out.contentType);
      res.status(out.status ?? 200 );
      if (typeof res.json !== 'function') {
        res.end(JSON.stringify(out.body));
      } else {
        res.json(out.body);
      }
      return;
    }

    case 'text':
    case 'html': {
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Length', utf8ByteLength(out.body));
      res.status(out.status).end(out.body);
      return;
    }

    case 'binary':
    case 'image': {
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Disposition', contentDisposition(out.disposition, out.filename));

      const bytes: Uint8Array = typeof out.body === 'string' ? stringToBytes(out.body, out.encoding) : out.body;

      res.setHeader('Content-Length', bytes.byteLength);
      // Node's ServerResponse accepts Buffer | string; Buffer.from shares underlying data for Uint8Array.
      res.status(out.status).end(Buffer.from(bytes));
      return;
    }

    case 'stream': {
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Disposition', contentDisposition(out.disposition, out.filename));
      res.status(out.status);
      if ('flushHeaders' in res && typeof res.flushHeaders === 'function') res.flushHeaders();

      // Prefer AsyncIterable path — Node Readable is async-iterable too.
      const maybeIter = (out.stream as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> })[
        Symbol.asyncIterator
        ];
      if (typeof maybeIter === 'function' && 'write' in res && typeof res.write === 'function') {
        for await (const chunk of out.stream as AsyncIterable<Uint8Array>) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      // Fallback: if only pipe() exists
      if ('pipe' in out.stream && typeof (out.stream as { pipe?: (dest: unknown) => unknown }).pipe === 'function') {
        // We don't cast to any; pipe accepts a generic destination that supports Writable-like API.
        (out.stream as { pipe: (dest: unknown) => unknown }).pipe(res);
        return;
      }

      res.status(500).end('Streaming not supported by response object');
      return;
    }

    case 'sse': {
      res.setHeader('Content-Type', out.contentType);
      if (!out.headers || !('Cache-Control' in out.headers)) res.setHeader('Cache-Control', 'no-cache');
      if (!out.headers || !('Connection' in out.headers)) res.setHeader('Connection', 'keep-alive');

      res.status(out.status);
      if ('flushHeaders' in res && typeof res.flushHeaders === 'function') res.flushHeaders();

      const maybeIter = (out.stream as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string> })[
        Symbol.asyncIterator
        ];
      if (typeof maybeIter === 'function' && 'write' in res && typeof res.write === 'function') {
        for await (const chunk of out.stream as AsyncIterable<Uint8Array | string>) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      if ('pipe' in out.stream && typeof (out.stream as { pipe?: (dest: unknown) => unknown }).pipe === 'function') {
        (out.stream as { pipe: (dest: unknown) => unknown }).pipe(res);
        return;
      }

      res.status(500).end('Streaming not supported by response object');
      return;
    }

    case 'jsonrpc': {
      res.setHeader('Content-Type', out.contentType);
      res.status(out.status);
      // Prefer json() if present; otherwise stringify
      if (typeof res.json === 'function') {
        res.json(out.body);
      } else {
        res.end(JSON.stringify(out.body));
      }
      return;
    }

    case 'problem': {
      res.setHeader('Content-Type', out.contentType);
      res.status(out.status);
      if (typeof res.json === 'function') {
        res.json(out.body);
      } else {
        res.end(JSON.stringify(out.body));
      }
      return;
    }

    case 'empty': {
      res.status(out.status).end();
      return;
    }
  }
}
