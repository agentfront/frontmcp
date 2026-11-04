import { httpOutputSchema, HttpRedirectSchema, httpRespond } from '../http-output.schema';

/** A redirect's `Location` is an absolute URL or a reference relative to the request (RFC 9110 section 10.2.2) (#1053). */
describe('HttpRedirectSchema', () => {
  it.each(['/board', 'board?view=week', '../board#today', '?page=2', 'https://desk.example.com/board'])(
    'takes %s as a location',
    (location) => {
      expect(HttpRedirectSchema.safeParse(httpRespond.redirect(location)).success).toBe(true);
    },
  );

  it.each([
    ['an empty location', ''],
    ['a line break that would split the header', '/board\r\nSet-Cookie: session=forged'],
    ['a space', '/my board'],
    ['a tab', '/board\t'],
    ['a NUL character', '/board\u0000'],
    ['an absolute URL that does not parse', 'http://[desk'],
  ])('refuses %s', (_case, location) => {
    expect(HttpRedirectSchema.safeParse(httpRespond.redirect(location)).success).toBe(false);
  });

  it('defaults the status to 302', () => {
    const parsed = httpOutputSchema.parse({ kind: 'redirect', location: '/board' });

    expect(parsed).toMatchObject({ kind: 'redirect', status: 302, location: '/board' });
  });
});
