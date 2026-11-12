import { employeeSitesSetKey, hoursKey, openKey, sessionsKey, siteEmployeesSetKey } from '../utils/keys';

describe('employee-time keys', () => {
  it('builds different keys for ids that differ only in where a colon falls', () => {
    expect(openKey('north:e1', 'x')).not.toBe(openKey('north', 'e1:x'));
    expect(hoursKey('north:e1', 'x', '2026-11-12')).not.toBe(hoursKey('north', 'e1:x', '2026-11-12'));
    expect(sessionsKey('north:e1', 'x', '2026-11-12')).not.toBe(sessionsKey('north', 'e1:x', '2026-11-12'));
  });

  it('builds different keys for an id with a colon and the same id already escaped', () => {
    expect(openKey('a:b', 'e1')).not.toBe(openKey('a%3Ab', 'e1'));
  });

  it('keeps the keys of ids without a colon or percent sign unchanged', () => {
    expect(openKey('north', 'e1')).toBe('et:open:north:e1');
    expect(hoursKey('north', 'e1', '2026-11-12')).toBe('et:hours:north:e1:2026-11-12');
    expect(sessionsKey('north', 'e1', '2026-11-12')).toBe('et:sessions:north:e1:2026-11-12');
    expect(siteEmployeesSetKey('north')).toBe('et:site:north:employees');
    expect(employeeSitesSetKey('e1')).toBe('et:emp:e1:sites');
  });
});
