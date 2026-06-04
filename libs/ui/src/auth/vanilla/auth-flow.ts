/**
 * `@frontmcp/ui/auth/vanilla` — framework-free helpers that read the injected
 * {@link AuthFlowState} global and drive the OAuth flow. No React.
 *
 * These are browser-DOM (client-only) primitives the `/auth` React hooks are
 * built on, and are usable directly from a non-React (or no-framework)
 * authorization page. The framework-free CONTRACT they consume is co-located in
 * `@frontmcp/ui/auth` (`./contract`); these helpers touch
 * `window`/`fetch`/`FormData`, so they are browser-only.
 *
 * @packageDocumentation
 */
import {
  AUTH_EXTRA_FIELD,
  AUTH_FLOW_GLOBAL_KEY,
  AUTH_WIRE_FIELDS,
  CONSENT_SUBMITTED_VALUE,
  DEFAULT_SUBMIT_METHOD,
  type AuthExtraResult,
  type AuthFlowState,
  type AuthFormInput,
  type AuthSubmitMethod,
} from '../contract';

/**
 * Resolve the object the server injected the flow state onto. Prefers `window`
 * (browser / jsdom) and falls back to `globalThis` (node test / SSR
 * environments). `globalThis` is always defined in every supported runtime, so
 * this never returns undefined — the return type stays optional only so callers
 * read defensively.
 */
function getGlobalCarrier(): Record<string, unknown> {
  if (typeof window !== 'undefined') {
    return window as unknown as Record<string, unknown>;
  }
  return globalThis as unknown as Record<string, unknown>;
}

/**
 * Read the server-injected {@link AuthFlowState}.
 *
 * @throws Error when no flow state has been injected (the page was not rendered
 * by a FrontMCP auth slot, or the injection script did not run yet). Callers
 * that want a tolerant read should use {@link tryGetAuthFlow}.
 */
export function getAuthFlow(): AuthFlowState {
  const state = tryGetAuthFlow();
  if (!state) {
    throw new Error(
      `[auth-ui] No injected auth flow state found on window.${AUTH_FLOW_GLOBAL_KEY}. ` +
        `This page must be server-rendered by a FrontMCP @AuthUi slot.`,
    );
  }
  return state;
}

/**
 * Read the server-injected {@link AuthFlowState}, or `undefined` when it is not
 * present. Does not throw — useful for optional/SSR-safe reads.
 */
export function tryGetAuthFlow(): AuthFlowState | undefined {
  const carrier = getGlobalCarrier();
  const state = carrier?.[AUTH_FLOW_GLOBAL_KEY];
  if (!state || typeof state !== 'object') {
    return undefined;
  }
  return state as AuthFlowState;
}

/**
 * Return the server-side accumulator for a named multi-step input (e.g. the
 * `envs` a user has added so far). Empty array when the name is absent.
 */
export function getAddedItems<T = unknown>(name: string): T[] {
  const items = tryGetAuthFlow()?.addedItems?.[name];
  return Array.isArray(items) ? (items as T[]) : [];
}

/**
 * Normalize any {@link AuthFormInput} into a flat list of `[key, value]` pairs,
 * preserving duplicate keys (so checkbox groups like `tools`/`providers`
 * survive). Values are coerced to strings; nullish values are skipped.
 */
function toEntries(input?: AuthFormInput): Array<[string, string]> {
  if (!input) {
    return [];
  }

  // A real <form> element → derive a FormData from it.
  if (isFormElement(input)) {
    return formDataToEntries(new FormData(input));
  }

  // A FormData instance.
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    return formDataToEntries(input);
  }

  // A plain record. Arrays expand into repeated keys.
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null) {
          entries.push([key, String(v)]);
        }
      }
    } else {
      entries.push([key, String(value)]);
    }
  }
  return entries;
}

/** Flatten a FormData into string `[key, value]` pairs (skips File entries). */
function formDataToEntries(fd: FormData): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  fd.forEach((value, key) => {
    if (typeof value === 'string') {
      entries.push([key, value]);
    }
  });
  return entries;
}

/** Narrow an {@link AuthFormInput} to an `HTMLFormElement` without a DOM dep at type time. */
function isFormElement(input: AuthFormInput): input is HTMLFormElement {
  return (
    typeof input === 'object' &&
    input !== null &&
    // `nodeName` + a `FormData`-constructible shape is enough; avoids requiring
    // a live `HTMLFormElement` global (jsdom provides one, node does not).
    (input as { nodeName?: string }).nodeName === 'FORM'
  );
}

/** Build a GET URL from a base and `[key, value]` pairs (duplicates preserved). */
function buildGetUrl(base: string, entries: Array<[string, string]>): string {
  // Resolve relative to the current document when available so app-relative
  // submitUrls (e.g. "/mcp/oauth/callback") work; fall back to a bare base.
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : undefined;
  const url = origin ? new URL(base, origin) : new URL(base, 'http://localhost');
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
  // If we synthesized a localhost origin only to parse a relative path, return
  // path + search so we don't leak the fake origin.
  if (!origin && !/^https?:\/\//i.test(base)) {
    return `${url.pathname}${url.search}`;
  }
  return url.toString();
}

/** Encode `[key, value]` pairs as an `application/x-www-form-urlencoded` body. */
function buildUrlEncodedBody(entries: Array<[string, string]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }
  return params.toString();
}

/**
 * Merge the caller's form entries with the control fields every submit needs
 * (`pending_auth_id`, `csrf`, plus any provided slot markers), without
 * clobbering values the caller already set.
 */
function withControlFields(
  state: AuthFlowState,
  entries: Array<[string, string]>,
  markers: Array<[string, string]>,
): Array<[string, string]> {
  const present = new Set(entries.map(([k]) => k));
  const merged = [...entries];

  const ensure = (key: string, value: string | undefined) => {
    if (value !== undefined && !present.has(key)) {
      merged.push([key, value]);
      present.add(key);
    }
  };

  ensure(AUTH_WIRE_FIELDS.pendingAuthId, state.pendingAuthId);
  ensure(AUTH_WIRE_FIELDS.csrf, state.csrfToken);
  for (const [key, value] of markers) {
    ensure(key, value);
  }
  return merged;
}

/** The slot markers a finish submit needs, derived from the slot. */
function finishMarkers(state: AuthFlowState): Array<[string, string]> {
  switch (state.slot) {
    case 'consent':
      return [[AUTH_WIRE_FIELDS.consentSubmitted, CONSENT_SUBMITTED_VALUE]];
    default:
      return [];
  }
}

/**
 * Dispatch the request described by `method`/`url`/`entries`. GET encodes the
 * entries into the query string and uses no body; POST sends a urlencoded body.
 */
async function dispatch(method: AuthSubmitMethod, url: string, entries: Array<[string, string]>): Promise<Response> {
  if (typeof fetch !== 'function') {
    throw new Error('[auth-ui] global fetch is unavailable in this environment');
  }
  if (method === 'GET') {
    return fetch(buildGetUrl(url, entries), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json, text/html' },
    });
  }
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/html',
    },
    body: buildUrlEncodedBody(entries),
  });
}

/**
 * Options for {@link submitFinish}.
 */
export interface SubmitFinishOptions {
  /**
   * When true (the default in a real browser), a non-redirected/non-JSON HTML
   * response causes a full navigation to `response.url` (the OAuth code
   * redirect). Set false to suppress navigation and inspect the {@link Response}
   * yourself (used by tests and SPA-style pages).
   */
  navigate?: boolean;
  /**
   * Drive the submit from this explicit flow state instead of reading the
   * injected `window.__FRONTMCP_AUTH__`. Used by the React hooks (which already
   * hold the state via context); standalone callers omit it.
   */
  state?: AuthFlowState;
}

/**
 * How {@link submitFinish} performs a top-level navigation to the OAuth
 * redirect. Defaults to `window.location.assign`. Exposed so SPA-style pages
 * (and tests) can override it via {@link setAuthNavigator} without fighting a
 * non-configurable `window.location`.
 */
export type AuthNavigator = (url: string) => void;

const defaultNavigator: AuthNavigator = (url) => {
  if (typeof window !== 'undefined' && window.location) {
    window.location.assign(url);
  }
};

let currentNavigator: AuthNavigator = defaultNavigator;

/**
 * Override the navigation function used to follow the OAuth redirect after a
 * successful {@link submitFinish}. Pass no argument to reset to the default
 * (`window.location.assign`).
 */
export function setAuthNavigator(navigator?: AuthNavigator): void {
  currentNavigator = navigator ?? defaultNavigator;
}

/**
 * Finish the authorization flow: submit identity / selection back to the
 * server's callback (`submitUrl`), carrying `pending_auth_id`, `csrf`, and the
 * slot's marker fields (e.g. `consent_submitted=1` for consent).
 *
 * On success the server responds with the OAuth redirect to the client's
 * `redirect_uri`; in a browser this helper follows it via a full navigation
 * unless {@link SubmitFinishOptions.navigate} is false.
 *
 * @param formOrData The developer's form/fields (identity inputs, selected
 * `tools`/`providers` checkboxes, etc.).
 * @param options Submit options. `options.state` lets a caller (e.g. the React
 * hooks) drive the submit from an explicit flow state instead of re-reading the
 * injected global; when omitted the injected `window.__FRONTMCP_AUTH__` is used.
 * @returns The raw {@link Response} (so callers can branch on a re-rendered
 * error page vs. a redirect).
 */
export async function submitFinish(formOrData?: AuthFormInput, options: SubmitFinishOptions = {}): Promise<Response> {
  const state = options.state ?? getAuthFlow();
  if (!state.submitUrl) {
    throw new Error('[auth-ui] submitFinish called but the injected flow state has no submitUrl');
  }
  const method = state.submitMethod ?? DEFAULT_SUBMIT_METHOD;
  const entries = withControlFields(state, toEntries(formOrData), finishMarkers(state));
  const response = await dispatch(method, state.submitUrl, entries);

  // Default to navigating when running in a real browser (location present).
  const shouldNavigate = options.navigate ?? (typeof window !== 'undefined' && !!window.location);
  if (shouldNavigate && response.redirected && response.url) {
    currentNavigator(response.url);
  }
  return response;
}

/**
 * Submit a single validated extra field (a `@AuthExtra(name)` round-trip).
 *
 * Posts the field data plus `pending_auth_id` + `csrf` to `extraUrl` when the
 * server provided one, otherwise to `submitUrl` with an `action=<name>` field
 * so the server can route it. Always uses POST (extras mutate server state —
 * unlike the GET finish round-trip).
 *
 * @param name The extra's name (must match the server's `@AuthExtra(name)`).
 * @param data The field value(s) to validate/add.
 * @param state Optional explicit flow state (the React hooks pass their context
 * state); when omitted the injected `window.__FRONTMCP_AUTH__` is used.
 * @returns A parsed {@link AuthExtraResult} (`{ ok, error?, addedItems? }`).
 */
export async function submitExtra(name: string, data?: AuthFormInput, state?: AuthFlowState): Promise<AuthExtraResult> {
  const flow = state ?? getAuthFlow();
  const target = flow.extraUrl ?? flow.submitUrl;
  if (!target) {
    throw new Error('[auth-ui] submitExtra called but the injected flow state has no extraUrl/submitUrl');
  }

  // Route by action name only when posting to the shared submitUrl.
  const markers: Array<[string, string]> = flow.extraUrl ? [] : [[AUTH_EXTRA_FIELD, name]];
  const entries = withControlFields(flow, toEntries(data), markers);

  const response = await dispatch('POST', target, entries);
  return parseExtraResponse(response);
}

/**
 * Parse an extra response into an {@link AuthExtraResult}. A JSON body is read
 * directly; a non-JSON success is treated as `{ ok: true }`, and any non-OK
 * HTTP status as `{ ok: false }` with a best-effort message.
 */
async function parseExtraResponse(response: Response): Promise<AuthExtraResult> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as Partial<AuthExtraResult> & Record<string, unknown>;
      return {
        ok: body.ok ?? response.ok,
        error: typeof body.error === 'string' ? body.error : undefined,
        addedItems:
          body.addedItems && typeof body.addedItems === 'object'
            ? (body.addedItems as Record<string, unknown[]>)
            : undefined,
        sideEffects:
          body.sideEffects && typeof body.sideEffects === 'object'
            ? (body.sideEffects as Record<string, unknown>)
            : undefined,
      };
    } catch {
      // Malformed JSON — fall through to status-based result.
    }
  }
  if (response.ok) {
    return { ok: true };
  }
  return { ok: false, error: `Request failed with status ${response.status}` };
}
