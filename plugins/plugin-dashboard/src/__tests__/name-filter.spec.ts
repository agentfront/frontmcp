/**
 * The dashboard's name filter: text a name contains, ignoring case.
 */
import { containsText } from '../shared/name-filter';

describe('containsText', () => {
  it('matches a name that contains the text, ignoring case', () => {
    const matches = containsText('Billing');

    expect(matches('ops:billing:list')).toBe(true);
    expect(matches('ops:users:list')).toBe(false);
  });

  it('takes regular expression syntax as text', () => {
    expect(containsText('billing.list')('billing:list')).toBe(false);
    expect(containsText('a|b')('a|b:tool')).toBe(true);
  });

  it('matches nothing for a pattern a regular expression would backtrack on', () => {
    const matches = containsText(String.raw`\w*a\w*a\w*a\w*a\w*a\w*b`);

    expect(matches('a'.repeat(60))).toBe(false);
  });
});
