/**
 * The name the auth pages show for a client (#1505): the CIMD `client_name`, else the registered one, else the
 * `client_id`; a name kept on the pending authorization wins, and an older record without it looks the client up.
 */
import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import {
  CLIENT_NAME_DISPLAY_MAX,
  clientDisplayName,
  resolveClientDisplayName,
  UNNAMED_CLIENT,
} from '../client-display-name';

const CLIENT_ID = '6f1c1c5e-3f7e-4a52-9d55-7d6c2b3b6a10';
const CIMD_CLIENT = 'https://client.example.com/oauth/metadata.json';

/** Characters written by code point, so this file holds none of the invisible ones it tests. */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const POP_DIRECTIONAL = String.fromCodePoint(0x202c);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

function scopeWith(auth: unknown): ScopeEntry {
  return { auth } as unknown as ScopeEntry;
}

describe('clientDisplayName', () => {
  it('takes the first name with something to show, else the client_id', () => {
    expect(clientDisplayName(CLIENT_ID, 'Desk companion', 'ChatGPT')).toBe('Desk companion');
    expect(clientDisplayName(CLIENT_ID, undefined, 'ChatGPT')).toBe('ChatGPT');
    expect(clientDisplayName(CLIENT_ID, '   ', `${ZERO_WIDTH_SPACE}`, undefined)).toBe(CLIENT_ID);
    expect(clientDisplayName(CLIENT_ID)).toBe(CLIENT_ID);
  });

  it('never shows a client_id with nothing visible unformatted', () => {
    expect(clientDisplayName(RIGHT_TO_LEFT_OVERRIDE)).toBe(UNNAMED_CLIENT);
    expect(clientDisplayName(`${ZERO_WIDTH_SPACE} \n`, `${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(UNNAMED_CLIENT);
    expect(clientDisplayName(`${RIGHT_TO_LEFT_OVERRIDE}client-7`)).toBe('client-7');
  });

  it('leaves HTML as text for the page to escape', () => {
    expect(clientDisplayName(CLIENT_ID, '<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('removes bidirectional overrides and zero-width spaces, and turns line breaks into spaces', () => {
    expect(clientDisplayName(CLIENT_ID, `Chat${ZERO_WIDTH_SPACE}GPT`)).toBe('ChatGPT');
    expect(clientDisplayName(CLIENT_ID, `Desk ${RIGHT_TO_LEFT_OVERRIDE}moc.elgoog${POP_DIRECTIONAL}`)).toBe(
      'Desk moc.elgoog',
    );
    expect(clientDisplayName(CLIENT_ID, `Desk\n\tcompanion${LINE_SEPARATOR}app\u0000`)).toBe('Desk companion app');
  });

  it('keeps the zero-width joiner an emoji needs', () => {
    const family = `\u{1F468}${ZERO_WIDTH_JOINER}\u{1F469}${ZERO_WIDTH_JOINER}\u{1F467}`;

    expect(clientDisplayName(CLIENT_ID, `${family} Family desk`)).toBe(`${family} Family desk`);
  });

  it(`cuts a name longer than ${CLIENT_NAME_DISPLAY_MAX} characters, without splitting a surrogate pair`, () => {
    const shown = clientDisplayName(CLIENT_ID, `${'a'.repeat(CLIENT_NAME_DISPLAY_MAX - 2)}\u{1F600}\u{1F600}tail`);

    expect(Array.from(shown)).toHaveLength(CLIENT_NAME_DISPLAY_MAX);
    expect(shown).toBe(`${'a'.repeat(CLIENT_NAME_DISPLAY_MAX - 2)}\u{1F600}…`);
    expect(clientDisplayName(CLIENT_ID, 'x'.repeat(10_000))).toHaveLength(CLIENT_NAME_DISPLAY_MAX);
    expect(clientDisplayName(CLIENT_ID, 'a'.repeat(CLIENT_NAME_DISPLAY_MAX))).toBe('a'.repeat(CLIENT_NAME_DISPLAY_MAX));
  });
});

describe('resolveClientDisplayName', () => {
  it('uses the name kept on the record without looking the client up', async () => {
    const load = jest.fn();

    const name = await resolveClientDisplayName(scopeWith({ dcrClientRegistry: { load } }), {
      clientId: CLIENT_ID,
      clientName: 'ChatGPT',
    });

    expect(name).toBe('ChatGPT');
    expect(load).not.toHaveBeenCalled();
  });

  it('reads the registration of a record written before the name was kept, from the token storage too', async () => {
    const load = jest.fn(async (id: string) => (id === CLIENT_ID ? { client_name: 'ChatGPT' } : undefined));

    expect(await resolveClientDisplayName(scopeWith({ dcrClientRegistry: { load } }), { clientId: CLIENT_ID })).toBe(
      'ChatGPT',
    );
    expect(load).toHaveBeenCalledWith(CLIENT_ID);
  });

  it('falls back to the client_id when the registration has no name, is gone, or cannot be read', async () => {
    const unnamed = scopeWith({ dcrClientRegistry: { load: async () => ({ client_name: undefined }) } });
    const gone = scopeWith({ dcrClientRegistry: { load: async () => undefined } });
    const failing = scopeWith({
      dcrClientRegistry: {
        load: async () => {
          throw new Error('storage down');
        },
      },
    });

    expect(await resolveClientDisplayName(unnamed, { clientId: CLIENT_ID })).toBe(CLIENT_ID);
    expect(await resolveClientDisplayName(gone, { clientId: CLIENT_ID })).toBe(CLIENT_ID);
    expect(await resolveClientDisplayName(failing, { clientId: CLIENT_ID })).toBe(CLIENT_ID);
    expect(await resolveClientDisplayName(scopeWith(undefined), { clientId: CLIENT_ID })).toBe(CLIENT_ID);
  });

  it("reads a CIMD client's document, and never the DCR registry for it", async () => {
    const load = jest.fn();
    const cimdService = {
      enabled: true,
      isCimdClientId: (id: string) => id.startsWith('https://'),
      resolveClientMetadata: async () => ({ metadata: { client_name: 'Desk companion' } }),
    };

    const name = await resolveClientDisplayName(scopeWith({ cimdService, dcrClientRegistry: { load } }), {
      clientId: CIMD_CLIENT,
    });

    expect(name).toBe('Desk companion');
    expect(load).not.toHaveBeenCalled();
  });

  it('falls back to the CIMD client_id when its document cannot be read', async () => {
    const cimdService = {
      enabled: true,
      isCimdClientId: () => true,
      resolveClientMetadata: async () => {
        throw new Error('fetch failed');
      },
    };

    expect(await resolveClientDisplayName(scopeWith({ cimdService }), { clientId: CIMD_CLIENT })).toBe(CIMD_CLIENT);
  });

  it('uses the registry get() of an auth instance without load()', async () => {
    const get = jest.fn(() => ({ client_name: 'Pre-registered Dashboard' }));

    expect(await resolveClientDisplayName(scopeWith({ dcrClientRegistry: { get } }), { clientId: 'dashboard' })).toBe(
      'Pre-registered Dashboard',
    );
  });
});
