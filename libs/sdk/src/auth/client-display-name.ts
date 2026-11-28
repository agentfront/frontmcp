/**
 * The name the built-in sign-in, provider and consent pages, a `login.render` page (`ctx.clientName`), the
 * `authenticate()` context and the `@AuthUi` state show for an OAuth client (#1505).
 *
 * A client's name is its CIMD document's `client_name`, else the `client_name` it registered (DCR, or `clientName` in
 * `dcr.clients`), else its `client_id`. The authorize flow resolves it once, from the CIMD document and registration it
 * validated, and keeps it on the pending authorization: the pages after it (the one shown again after a failed
 * sign-in, the consent screens) use that name, even when the registration is no longer in memory.
 *
 * Every name except a pre-registered one is self-asserted: a DCR `client_name` comes from an unauthenticated
 * `POST /oauth/register`. It is shown as text only: the built-in pages escape it, and `login.render` must too. For
 * display it is cut to {@link CLIENT_NAME_DISPLAY_MAX} characters, with line breaks, control characters and invisible
 * formatting characters (bidirectional overrides, zero-width spaces) removed, so it can neither reorder nor hide the
 * text around it. The registration itself keeps what the client sent.
 */
import type { ScopeEntry } from '../common';
import type { LocalPrimaryAuth } from './instances/instance.local-primary-auth';

/** The longest client name the pages show, in characters. A longer one ends with `…`. */
export const CLIENT_NAME_DISPLAY_MAX = 64;

/** What the pages show for a client whose name and `client_id` have nothing visible left. */
export const UNNAMED_CLIENT = 'Unnamed client';

/** Control characters and line or paragraph separators: shown as a space. */
const BREAKING_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * Format characters (bidirectional overrides and isolates, zero-width spaces, the byte order mark…): removed. The
 * zero-width joiner and non-joiner stay, as emoji and some scripts need them.
 */
const INVISIBLE_CHARACTERS = /(?![\u200C\u200D])\p{Cf}/gu;

/** `name` as the pages show it; empty when nothing visible is left. */
function forDisplay(name: string): string {
  const visible = name.replace(BREAKING_CHARACTERS, ' ').replace(INVISIBLE_CHARACTERS, '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(visible);
  if (characters.length <= CLIENT_NAME_DISPLAY_MAX) return visible;
  return `${characters
    .slice(0, CLIENT_NAME_DISPLAY_MAX - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * The first of `names` with something to show, as the pages show it, else `clientId` as they show it, else
 * {@link UNNAMED_CLIENT}: an unregistered client's id is whatever the request sent, and is never shown unformatted.
 *
 * @param clientId - the client's `client_id`, the last fallback
 * @param names - candidate names, most trusted first (CIMD `client_name`, then the registered `client_name`)
 */
export function clientDisplayName(clientId: string, ...names: Array<string | undefined>): string {
  for (const name of names) {
    const shown = typeof name === 'string' ? forDisplay(name) : '';
    if (shown) return shown;
  }
  return forDisplay(clientId) || UNNAMED_CLIENT;
}

/**
 * The display name of the client of a pending authorization or federated session.
 *
 * The name kept on the record wins. A record written before it was kept falls back to the client's CIMD document,
 * then its registration (read from the token storage when this process doesn't hold it), then its `client_id`. A
 * lookup that fails falls through to the next one.
 */
export async function resolveClientDisplayName(
  scope: ScopeEntry,
  client: { clientId: string; clientName?: string },
): Promise<string> {
  const { clientId } = client;
  if (client.clientName) return clientDisplayName(clientId, client.clientName);

  const auth = scope.auth as
    | (Partial<Pick<LocalPrimaryAuth, 'dcrClientRegistry'>> & {
        cimdService?: {
          enabled?: boolean;
          isCimdClientId?: (id: string) => boolean;
          resolveClientMetadata?: (id: string) => Promise<{ metadata?: { client_name?: string } }>;
        };
      })
    | undefined;

  const cimd = auth?.cimdService;
  if (cimd?.enabled && cimd.isCimdClientId?.(clientId)) {
    try {
      const resolution = await cimd.resolveClientMetadata?.(clientId);
      return clientDisplayName(clientId, resolution?.metadata?.client_name);
    } catch {
      return clientDisplayName(clientId);
    }
  }

  const registry = auth?.dcrClientRegistry;
  try {
    const registered = registry?.load ? await registry.load(clientId) : registry?.get?.(clientId);
    return clientDisplayName(clientId, registered?.client_name);
  } catch {
    return clientDisplayName(clientId);
  }
}
