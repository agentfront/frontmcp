import { z } from 'zod';
import { ServerRequest } from '../interfaces';

/* --------------------------------- Schemas --------------------------------- */

export const intentSchema = z.union([
  z.literal('legacy-sse'),
  z.literal('sse'),
  z.literal('streamable-http'),
  z.literal('stateful-http'),
  z.literal('stateless-http'),
  z.literal('delete-session'),
  z.literal('unknown'),
]);

export const decisionSchema = z.object({
  intent: intentSchema,
  reasons: z.array(z.string()),
  recommendation: z
    .object({
      httpStatus: z.number(),
      message: z.string(),
    })
    .optional(),
  // Echo back bits for debugging/telemetry if you like
  debug: z
    .object({
      key: z.number(),
      channel: z.number(),
      flags: z.number(),
    })
    .optional(),
});

export type HttpRequestIntent =
  | 'legacy-sse'
  | 'sse'
  | 'streamable-http'
  | 'stateful-http'
  | 'stateless-http'
  | 'delete-session';

export type Intent = HttpRequestIntent | 'unknown';

export type Decision = {
  intent: Intent;
  reasons: string[];
  recommendation?: { httpStatus: number; message: string };
  // Echo back bits for debugging/telemetry if you like
  debug?: { key: number; channel: number; flags: number };
};

export interface Config {
  enableLegacySSE: boolean;
  enableSseListener: boolean;
  enableStreamableHttp: boolean;
  enableStatefulHttp: boolean;
  enableStatelessHttp: boolean;
  requireSessionForStreamable: boolean;
  tolerateMissingAccept: boolean;
}

/* ------------------------------- Bit layout ---------------------------------

bits 0..2  CHANNEL
           000 OTHER
           001 GET_SSE                 (GET + Accept: text/event-stream)
           010 POST_INIT_JSON          (POST initialize + Accept: application/json or default JSON)
           011 POST_INIT_SSE           (POST initialize + Accept: text/event-stream)
           100 POST_JSON               (POST non-init + Accept: application/json or default JSON)
           101 POST_SSE                (POST non-init + Accept: text/event-stream)
           110 POST_MESSAGE            (POST to /message)  ← legacy bridge

bit 3      HAS_SESSION                 (Mcp-Session-Id present)
bit 4      STATELESS_EN                (config: enableStatelessHttp)
bit 5      REQ_SESSION                 (config: requireSessionForStreamable)
bit 6      LEGACY_HINT                 (x-legacy-sse=true OR session.transportType=legacy-sse)
bit 7      SSE_LISTENER_EN             (config: enableSseListener)
bit 8      STREAMABLE_EN               (config: enableStreamableHttp)
bit 9      STATEFUL_EN                 (config: enableStatefulHttp)
bit 10     LEGACY_EN                   (config: enableLegacySSE)

----------------------------------------------------------------------------- */

// --- Channels ---------------------------------------------------------------

const CH_OTHER = 0b000;
const CH_GET_SSE = 0b001; // GET / + SSE (not handled, forward to next middleware)
const CH_POST_INIT_JSON = 0b010;
const CH_POST_INIT_SSE = 0b011;
const CH_POST_JSON = 0b100;
const CH_POST_SSE = 0b101;
const CH_POST_MESSAGE = 0b110; // POST /message (legacy bridge)
const CH_GET_SSE_PATH = 0b111; // GET /sse path (legacy SSE initialize)

const CH_MASK = 0b00000111;

// --- Flags ------------------------------------------------------------------

const B_HAS_SESSION = 1 << 3; // 8
const B_STATELESS_EN = 1 << 4; // 16
const B_REQ_SESSION = 1 << 5; // 32
const B_LEGACY_HINT = 1 << 6; // 64 (kept for telemetry; not required by merged rules)
const B_SSE_LISTENER_EN = 1 << 7; // 128
const B_STREAMABLE_EN = 1 << 8; // 256
const B_STATEFUL_EN = 1 << 9; // 512
const B_LEGACY_EN = 1 << 10; // 1024

// --- Minimal helpers ---------------------------------------------------------

const h = (req: ServerRequest, name: string) =>
  Object.entries(req.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

const wantsSSE = (accept?: string) => (accept ?? '').toLowerCase().includes('text/event-stream');
const wantsJSON = (accept?: string) => (accept ?? '').toLowerCase().includes('application/json');
const isInitialize = (body: unknown) => !!body && typeof body === 'object' && (body as any).method === 'initialize';

// Robust path extractor (supports absolute/relative)
function pathOf(req: ServerRequest): string {
  const anyReq = req as any;
  const raw = anyReq.path ?? anyReq.pathname ?? anyReq.url ?? '/';
  try {
    const u = new URL(String(raw), 'http://local');
    return u.pathname || '/';
  } catch {
    return String(raw).split('?')[0] || '/';
  }
}

// Check if path is the legacy SSE path (/sse)
function isLegacySsePath(path: string): boolean {
  return path === '/sse' || path.endsWith('/sse');
}

/** Optionally extract transportType from base64 JSON session id, if you embed it. */
function tryDecodeTransportType(sessionId?: string): string | undefined {
  if (!sessionId) return;
  try {
    const b64 = sessionId.replace(/-/g, '+').replace(/_/g, '/');
    const obj = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return obj?.transportType;
  } catch {
    return;
  }
}

// --- Build the 11-bit key ----------------------------------------------------

function computeBitmap(req: ServerRequest, cfg: Config) {
  const method = req.method.toUpperCase();
  const accept = h(req, 'accept');
  const sessionId = h(req, 'mcp-session-id');
  const legacyHeader = h(req, 'x-legacy-sse') === 'true';
  const transportType = tryDecodeTransportType(sessionId);
  const path = pathOf(req);

  const acceptSSE = wantsSSE(accept);
  const acceptJSON = wantsJSON(accept) || (!accept && cfg.tolerateMissingAccept);
  const init = method === 'POST' && isInitialize(req.body);
  const postToMessage = method === 'POST' && (path === '/message' || path.endsWith('/message'));
  const getToSsePath = method === 'GET' && isLegacySsePath(path);

  const channel =
    method === 'POST' && postToMessage
      ? CH_POST_MESSAGE
      : getToSsePath && acceptSSE
      ? CH_GET_SSE_PATH // GET /sse → legacy SSE channel
      : method === 'GET' && acceptSSE
      ? CH_GET_SSE // GET / + SSE → forward to next middleware (unknown)
      : method === 'POST' && init && acceptSSE
      ? CH_POST_INIT_SSE
      : method === 'POST' && init && acceptJSON
      ? CH_POST_INIT_JSON
      : method === 'POST' && !init && acceptSSE
      ? CH_POST_SSE
      : method === 'POST' && !init && acceptJSON
      ? CH_POST_JSON
      : CH_OTHER;

  let flags = 0;
  if (sessionId) flags |= B_HAS_SESSION;
  if (cfg.enableStatelessHttp) flags |= B_STATELESS_EN;
  if (cfg.requireSessionForStreamable) flags |= B_REQ_SESSION;
  if (legacyHeader || transportType === 'legacy-sse') flags |= B_LEGACY_HINT; // informational
  if (cfg.enableSseListener) flags |= B_SSE_LISTENER_EN;
  if (cfg.enableStreamableHttp) flags |= B_STREAMABLE_EN;
  if (cfg.enableStatefulHttp) flags |= B_STATEFUL_EN;
  if (cfg.enableLegacySSE) flags |= B_LEGACY_EN;

  return { key: (channel & CH_MASK) | flags, channel, flags, init };
}

// --- Rule definition ---------------------------------------------------------

type Rule = {
  care: number; // which bits matter
  match: number; // the exact bit pattern to match (after masking)
  outcome: Omit<Decision, 'reasons' | 'debug'> & { reason: string };
};

// --- Rules (merged semantics) -----------------------------------------------

const RULES: Rule[] = [
  // A) Legacy SSE via GET /sse path (without session) → requires legacy enabled
  {
    care: CH_MASK | B_HAS_SESSION | B_LEGACY_EN,
    match: CH_GET_SSE_PATH | B_LEGACY_EN, // HAS_SESSION must be 0; it's in 'care' but not in 'match'
    outcome: { intent: 'legacy-sse', reason: 'GET /sse without Mcp-Session-Id → legacy SSE.' },
  },
  {
    care: CH_MASK | B_HAS_SESSION | B_LEGACY_EN,
    match: CH_GET_SSE_PATH /* legacy disabled; HAS_SESSION=0 */,
    outcome: {
      intent: 'unknown',
      reason: 'Legacy SSE disabled.',
      recommendation: { httpStatus: 405, message: 'Legacy SSE disabled' },
    },
  },

  // A2) GET / + SSE (not /sse path) with session ID → SSE listener for streamable-http
  // Per MCP 2025-11-25 spec, clients can open SSE stream via GET with session ID
  {
    care: CH_MASK | B_HAS_SESSION | B_SSE_LISTENER_EN | B_STREAMABLE_EN,
    match: CH_GET_SSE | B_HAS_SESSION | B_SSE_LISTENER_EN | B_STREAMABLE_EN,
    outcome: { intent: 'streamable-http', reason: 'GET / with session ID → SSE listener for streamable-http.' },
  },
  // A2b) GET / + SSE with session but listener/streamable disabled
  {
    care: CH_MASK | B_HAS_SESSION | B_SSE_LISTENER_EN,
    match: CH_GET_SSE | B_HAS_SESSION /* listener disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'SSE listener disabled for GET / requests.',
      recommendation: { httpStatus: 405, message: 'SSE listener disabled' },
    },
  },
  // A2c) GET / + SSE without session → forward to next middleware
  {
    care: CH_MASK | B_HAS_SESSION,
    match: CH_GET_SSE /* no session */,
    outcome: {
      intent: 'unknown',
      reason: 'GET / with SSE requires session for MCP transport.',
    },
  },

  // B) Legacy SSE: POST /message WITH session id
  {
    care: CH_MASK | B_HAS_SESSION | B_LEGACY_EN,
    match: CH_POST_MESSAGE | B_HAS_SESSION | B_LEGACY_EN,
    outcome: { intent: 'legacy-sse', reason: 'POST /message with Mcp-Session-Id → legacy SSE bridge.' },
  },
  {
    care: CH_MASK | B_HAS_SESSION | B_LEGACY_EN,
    match: CH_POST_MESSAGE | B_HAS_SESSION /* legacy disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'Legacy /message endpoint disabled.',
      recommendation: { httpStatus: 405, message: 'Legacy SSE disabled' },
    },
  },

  // C) Modern SSE (GET /sse with session) → requires SSE listener enabled
  {
    care: CH_MASK | B_SSE_LISTENER_EN | B_HAS_SESSION,
    match: CH_GET_SSE_PATH | B_HAS_SESSION /* listener disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'SSE listener disabled.',
      recommendation: { httpStatus: 405, message: 'SSE listener disabled' },
    },
  },
  {
    care: CH_MASK | B_SSE_LISTENER_EN | B_HAS_SESSION,
    match: CH_GET_SSE_PATH | B_SSE_LISTENER_EN | B_HAS_SESSION,
    outcome: { intent: 'sse', reason: 'GET /sse with Mcp-Session-Id.' },
  },

  // D) Initialize (POST → SSE)
  // D1) Stateless initialize (no session, stateless enabled) - must come before streamable rules
  {
    care: CH_MASK | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_INIT_SSE | B_STATELESS_EN /* no session */,
    outcome: { intent: 'stateless-http', reason: 'Stateless initialize (no session).' },
  },
  {
    care: CH_MASK | B_STREAMABLE_EN,
    match: CH_POST_INIT_SSE /* streamable disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'Streamable HTTP disabled.',
      recommendation: { httpStatus: 405, message: 'Streamable HTTP disabled' },
    },
  },
  {
    care: CH_MASK | B_STREAMABLE_EN,
    match: CH_POST_INIT_SSE | B_STREAMABLE_EN,
    outcome: { intent: 'streamable-http', reason: 'Initialize with SSE.' },
  },

  // E) Initialize (POST → JSON)
  // E1) Stateless initialize JSON (no session, stateless enabled) - must come before stateful rules
  {
    care: CH_MASK | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_INIT_JSON | B_STATELESS_EN /* no session */,
    outcome: { intent: 'stateless-http', reason: 'Stateless initialize JSON (no session).' },
  },
  {
    care: CH_MASK | B_STREAMABLE_EN,
    match: CH_POST_INIT_JSON /* streamable disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'JSON mode disabled.',
      recommendation: { httpStatus: 405, message: 'JSON mode disabled' },
    },
  },
  {
    care: CH_MASK | B_STREAMABLE_EN,
    match: CH_POST_INIT_JSON | B_STREAMABLE_EN,
    outcome: { intent: 'stateful-http', reason: 'Initialize with JSON.' },
  },

  // F) POST non-init → SSE
  {
    care: CH_MASK | B_REQ_SESSION | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_SSE | B_REQ_SESSION /* !HAS_SESSION & !STATELESS_EN */,
    outcome: {
      intent: 'unknown',
      reason: 'POST SSE requires session.',
      recommendation: { httpStatus: 400, message: 'Initialize required (no Mcp-Session-Id)' },
    },
  },
  {
    care: CH_MASK | B_STREAMABLE_EN,
    match: CH_POST_SSE /* streamable disabled */,
    outcome: {
      intent: 'unknown',
      reason: 'Streamable HTTP disabled.',
      recommendation: { httpStatus: 405, message: 'Streamable HTTP disabled' },
    },
  },
  {
    care: CH_MASK | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_SSE | B_STATELESS_EN /* no session */,
    outcome: { intent: 'stateless-http', reason: 'Stateless short-lived SSE.' },
  },
  {
    care: CH_MASK,
    match: CH_POST_SSE,
    outcome: { intent: 'streamable-http', reason: 'Short-lived SSE for this request.' },
  },

  // G) POST non-init → JSON
  {
    care: CH_MASK | B_REQ_SESSION | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_JSON | B_REQ_SESSION /* !HAS_SESSION & !STATELESS_EN */,
    outcome: {
      intent: 'unknown',
      reason: 'POST JSON requires session.',
      recommendation: { httpStatus: 400, message: 'Initialize required (no Mcp-Session-Id)' },
    },
  },
  {
    care: CH_MASK | B_STATEFUL_EN | B_STREAMABLE_EN,
    match: CH_POST_JSON /* neither enabled */,
    outcome: {
      intent: 'unknown',
      reason: 'JSON mode disabled.',
      recommendation: { httpStatus: 405, message: 'JSON mode disabled' },
    },
  },
  {
    care: CH_MASK | B_HAS_SESSION | B_STATELESS_EN,
    match: CH_POST_JSON | B_STATELESS_EN /* no session */,
    outcome: { intent: 'stateless-http', reason: 'Stateless JSON request.' },
  },
  {
    care: CH_MASK,
    match: CH_POST_JSON,
    outcome: { intent: 'stateful-http', reason: 'Aggregated JSON response.' },
  },

  // H) Fallback
  {
    care: CH_MASK,
    match: CH_OTHER,
    outcome: {
      intent: 'unknown',
      reason: 'Method/Accept not allowed.',
      recommendation: { httpStatus: 405, message: 'Method/Accept not allowed' },
    },
  },
];

// --- Public API --------------------------------------------------------------

export function decideIntent(req: ServerRequest, cfg: Config): Decision {
  const reasons: string[] = [];
  const method = req.method.toUpperCase();

  // Handle HTTP DELETE for session termination (MCP 2025-11-25 spec)
  if (method === 'DELETE') {
    const sessionId = h(req, 'mcp-session-id');
    if (!sessionId) {
      return {
        intent: 'unknown',
        reasons: ['DELETE requires Mcp-Session-Id header.'],
        recommendation: { httpStatus: 400, message: 'Session ID required for DELETE' },
        debug: { key: 0, channel: 0, flags: 0 },
      };
    }
    return {
      intent: 'delete-session',
      reasons: ['DELETE with Mcp-Session-Id → session termination.'],
      debug: { key: 0, channel: 0, flags: sessionId ? B_HAS_SESSION : 0 },
    };
  }

  const { key, channel, flags, init } = computeBitmap(req, cfg);

  // Optional strict Accept validation for POST (incl. /message)
  if (method === 'POST') {
    const accept = h(req, 'accept');
    const acceptsSSE = wantsSSE(accept);
    const acceptsJSON = wantsJSON(accept) || (!accept && cfg.tolerateMissingAccept);
    if (!acceptsSSE && !acceptsJSON) {
      return {
        intent: 'unknown',
        reasons: ['Client must accept application/json or text/event-stream.'],
        recommendation: { httpStatus: 406, message: 'Not acceptable' },
        debug: { key, channel, flags },
      };
    }
  }

  for (const rule of RULES) {
    if ((key & rule.care) === rule.match) {
      const { reason, ...rest } = rule.outcome;
      reasons.push(reason);
      if (init) reasons.push('Initialize body detected.');
      return { ...rest, reasons, debug: { key, channel, flags } };
    }
  }

  return {
    intent: 'unknown',
    reasons: ['No matching rule.'],
    recommendation: { httpStatus: 500, message: 'Unroutable request' },
    debug: { key, channel, flags },
  };
}
